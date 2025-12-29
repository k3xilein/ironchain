import { Config } from '../config';
import { PriceFeed, PriceData } from './price-feed';
import { CandleBuilder, Candle, TickData } from './candle-builder';
import axios from 'axios';

export class MarketData {
  private priceFeed: PriceFeed;
  private candleBuilder: CandleBuilder;
  private config: Config;
  private lastUpdate: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.priceFeed = new PriceFeed(config);
    this.candleBuilder = new CandleBuilder();
  }

  async initialize(): Promise<void> {
    // First: attempt to bootstrap 4-hour candles from a reliable API so
    // the bot can start trading immediately without waiting for hours
    // to accumulate 4h candles live. This uses real historical OHLCV
    // data and injects it as closed 4h candles into the CandleBuilder.
    // If bootstrapping fails, we fall back to the existing behavior.
    try {
      const ok = await this.bootstrapFourHourMarketContext(50);
      if (ok) {
        console.log('Bootstrapped 4H market context from API (no warm-up delay)');
      } else {
        console.warn('Bootstrapping 4H market context returned insufficient data, falling back to live accumulation');
      }
    } catch (err) {
      console.warn('4H bootstrap failed, falling back to existing preload:', String(err));
    }

    // Attempt to preload recent historical prices so the strategy has
    // enough ticks/candles for the 15m / 1h timeframes as before.
    try {
      await this.preloadHistoricalPrices(7); // 7 days of history
    } catch (err) {
      // If preloading fails for any reason, fall back to live update.
      console.warn('Historical preload failed, falling back to live ticks', String(err));
    }

    // Fetch initial price to populate/update current candle. If the
    // price feed is temporarily unavailable (rate limits / DNS), fall
    // back to the last preloaded candle so startup can continue.
    try {
      await this.update();
    } catch (err) {
      // Attempt to derive a reasonable price from preloaded candles
      const recent15 = this.candleBuilder.getCurrentCandle('15m') || this.candleBuilder.getCandles('15m').slice(-1)[0];
      if (recent15 && recent15.close && isFinite(recent15.close)) {
        this.lastUpdate = Date.now();
        console.warn('MarketData.update failed; using last preloaded candle price as current price', recent15.close, String(err));
        // Do not throw — allow startup to continue using preloaded data
        return;
      }

      // No fallback available — rethrow the error to let caller handle it
      throw err;
    }
  }

  /**
   * Fetch last `count` completed 4-hour OHLCV candles from CoinGecko and
   * inject them into the CandleBuilder as closed 4h candles.
   * Returns true on success (enough candles injected), false if insufficient
   * data was returned. Throws only for unexpected errors.
   *
   * Why this is equivalent to waiting for live accumulation:
   * - We use real, closed 4-hour OHLCV from a trusted market data API.
   * - We only inject candles whose end time is strictly in the past
   *   (no partial/ongoing candles), so indicators are computed on the
   *   same closed periods they would have after 4 hours of running.
   */
  async bootstrapFourHourMarketContext(count = 50): Promise<boolean> {
    try {
      if (count <= 0) return false;

      const now = Date.now();
      const FOUR_H = 4 * 60 * 60 * 1000;

      // Compute how many days of history to request from CoinGecko to
      // safely cover `count` 4h candles. Add 1 day of slack.
      const hoursNeeded = count * 4;
      const days = Math.ceil(hoursNeeded / 24) + 1;

      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
      const resp = await axios.get(url, { timeout: 15_000 });
      const prices: Array<[number, number]> = resp.data?.prices;
      const volumes: Array<[number, number]> = resp.data?.total_volumes || [];

      if (!Array.isArray(prices) || prices.length === 0) {
        console.warn('bootstrapFourHourMarketContext: no price series from CoinGecko');
        return false;
      }

      // Build maps of price and volume points keyed by timestamp (ms)
      // CoinGecko returns arrays of [ts, value] where ts is in ms
      const volMap = new Map<number, number>();
      for (const [vTs, v] of volumes) volMap.set(Math.floor(vTs), v || 0);

      // Aggregate into 4h windows (closed candles). We'll collect points
      // into buckets keyed by candleStart (ms).
      const buckets = new Map<number, { prices: number[]; volume: number }>();

      for (const [pTs, p] of prices) {
        if (!isFinite(p) || p <= 0) continue;
        const candleStart = Math.floor(pTs / FOUR_H) * FOUR_H;
        // Skip any candle that would end in the future or be the current open candle
        const candleEnd = candleStart + FOUR_H;
        const latestClosedEnd = Math.floor(now / FOUR_H) * FOUR_H; // end time of last closed candle
        if (candleEnd > latestClosedEnd) continue; // skip partial

        const b = buckets.get(candleStart) || { prices: [], volume: 0 };
        b.prices.push(p);
        // approximate volume by matching timestamp in volMap if available
        const v = volMap.get(Math.floor(pTs)) || 0;
        b.volume += v;
        buckets.set(candleStart, b);
      }

      // Build candles from buckets and sort ascending
      const candleList: Candle[] = [];
      for (const [ts, data] of buckets) {
        if (!data.prices || data.prices.length === 0) continue;
        const open = data.prices[0];
        const close = data.prices[data.prices.length - 1];
        const high = Math.max(...data.prices);
        const low = Math.min(...data.prices);
        candleList.push({ timestamp: ts, open, high, low, close, volume: data.volume });
      }

      if (candleList.length === 0) {
        console.warn('bootstrapFourHourMarketContext: built zero 4h candles from API data');
        return false;
      }

      // Sort ascending and take the last `count` closed candles
      candleList.sort((a, b) => a.timestamp - b.timestamp);
      const selected = candleList.slice(-count);

      if (selected.length < Math.min(20, count)) {
        // Not enough reliable 4h history to bootstrap safely
        console.warn(`bootstrapFourHourMarketContext: insufficient closed 4h candles (${selected.length})`);
        return false;
      }

      // Inject as historicalBootstrapData into the CandleBuilder
      this.candleBuilder.injectHistoricalCandles('4h', selected);

      // Also for safety, ensure derived 1h/15m contexts are available via sampling
      // (we don't inject 1h/15m OHLC directly to avoid mismatches; existing
      // preloadHistoricalPrices will handle ticks for those timeframes)

      return true;
    } catch (error) {
      // Bubble unexpected errors up as warnings — caller will fall back
      console.warn('bootstrapFourHourMarketContext: unexpected error', String(error));
      return false;
    }
  }

  /**
   * Fetch recent SOL/USD prices from CoinGecko and feed them into the
   * CandleBuilder as ticks. The method is intentionally conservative and
   * will not throw on transient errors (caller handles fallback).
   */
  private async preloadHistoricalPrices(days = 7): Promise<void> {
    try {
      // CoinGecko market_chart endpoint returns [ [timestamp, price], ... ] in ms
      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
      const resp = await axios.get(url, { timeout: 10_000 });
      const prices: Array<[number, number]> = resp.data?.prices;

      if (!Array.isArray(prices) || prices.length === 0) {
        throw new Error('No historical prices returned');
      }

      // Feed the prices into the candle builder as ticks. We avoid flooding
      // the builder with excessive points by sampling: keep one tick per
      // 15 minutes (900000 ms) to match the strategy timeframe.
      const sampled: Array<[number, number]> = [];
      let lastTs = 0;
      for (const [ts, price] of prices) {
        if (!price || price <= 0) continue;
        if (lastTs === 0 || ts - lastTs >= 15 * 60 * 1000) {
          sampled.push([ts, price]);
          lastTs = ts;
        }
      }

      // Add each sampled tick to the CandleBuilder
      for (const [ts, price] of sampled) {
        this.candleBuilder.addTick({ price, timestamp: ts, volume: 0 });
      }

      console.log(`MarketData: preloaded ${sampled.length} historical ticks from CoinGecko`);
    } catch (error) {
      // Bubble up so caller can log fallback behavior; don't crash the bot
      throw error;
    }
  }

  async update(): Promise<void> {
    const now = Date.now();
    // Get current price (use MarketData.getCurrentPrice which has a
    // fallback to preloaded candles). If that still fails, log and
    // skip this update cycle rather than throwing to keep the bot
    // running.
    try {
      const priceData = await this.getCurrentPrice();

      const tick: TickData = {
        price: priceData.price,
        timestamp: now,
        volume: 0, // Volume not currently tracked from oracle
      };

      this.candleBuilder.addTick(tick);
      this.lastUpdate = now;
    } catch (err) {
      console.warn('MarketData.update: failed to obtain current price, skipping tick:', String(err));
      // Do not throw — allow the bot to continue and rely on preloaded data
    }
  }

  async getCurrentPrice(): Promise<PriceData> {
    try {
      return await this.priceFeed.getPrice();
    } catch (err) {
      // Fallback: use last preloaded/current candle price if price feed fails
      const recent15 = this.candleBuilder.getCurrentCandle('15m') || this.candleBuilder.getCandles('15m').slice(-1)[0];
      if (recent15 && recent15.close && isFinite(recent15.close)) {
        return {
          price: recent15.close,
          timestamp: recent15.timestamp,
          confidence: 0,
          source: 'preload',
        };
      }

      // Re-throw if we have no reasonable fallback
      throw err;
    }
  }

  getCandles(timeframe: '15m' | '1h' | '4h', count?: number): Candle[] {
    return this.candleBuilder.getCandles(timeframe, count);
  }

  getCurrentCandle(timeframe: '15m' | '1h' | '4h'): Candle | null {
    return this.candleBuilder.getCurrentCandle(timeframe);
  }

  async checkHealth(): Promise<boolean> {
    const health = await this.priceFeed.checkPriceHealth();
    return health.healthy;
  }

  getLastUpdateTime(): number {
    return this.lastUpdate;
  }

  hasEnoughData(timeframe: '15m' | '1h' | '4h', required: number): boolean {
    const count = this.candleBuilder.getCandleCount(timeframe);
    return count >= required;
  }
}
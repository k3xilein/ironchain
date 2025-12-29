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
    // Attempt to preload recent historical prices so the strategy has
    // enough candles immediately after startup. This is non-invasive
    // (data bootstrapping only) and does not change core strategy logic.
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
    
    // Get current price
    const priceData = await this.priceFeed.getPrice();
    
    // Add tick to candle builder
    const tick: TickData = {
      price: priceData.price,
      timestamp: now,
      volume: 0, // Volume not currently tracked from oracle
    };
    
    this.candleBuilder.addTick(tick);
    this.lastUpdate = now;
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
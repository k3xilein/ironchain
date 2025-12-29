import { Config } from '../config';
import { PriceFeed, PriceData } from './price-feed';
import { CandleBuilder, Candle, TickData } from './candle-builder';
import axios from 'axios';

// Minimal, robust MarketData implementation focused on providing a fresh
// live price every cycle (force=true) and bootstrapping 4h history.
export class MarketData {
  private priceFeed: PriceFeed;
  private candleBuilder: CandleBuilder;
  private config: Config;
  private lastUpdate: number = 0;
  private lastTickPrice: PriceData | null = null;

  constructor(config: Config) {
    this.config = config;
    this.priceFeed = new PriceFeed(config);
    this.candleBuilder = new CandleBuilder();
  }

  async initialize(): Promise<void> {
    // Try to bootstrap closed 4h candles so strategy has required history
    try { await this.bootstrapFourHourMarketContext(); } catch (e) { /* best-effort */ }
    // Preload ticks for 15m/1h
    try { await this.preloadHistoricalPrices(7); } catch (e) { /* best-effort */ }
    // Prime by fetching a live price
    try { await this.update(); } catch (e) { /* best-effort */ }
  }

  private logInfo(...args: any[]) { try { console.info(...args); } catch (e) {} }
  private logWarn(...args: any[]) { try { console.warn(...args); } catch (e) {} }

  async bootstrapFourHourMarketContext(count?: number): Promise<boolean> {
    // Derive required count from config if not provided
    const requiredFromConfig = (this.config && this.config.regime && (this.config.regime as any).emaSlow)
      ? ((this.config.regime as any).emaSlow + 50)
      : 50;
    const targetCount = (typeof count === 'number' && count > 0) ? count : requiredFromConfig;
    if (targetCount <= 0) return false;

    // Try CoinGecko first (market_chart), fall back to Binance klines
    try {
      const FOUR_H = 4 * 60 * 60 * 1000;
      const days = Math.ceil((targetCount * 4) / 24) + 1;
      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
      const resp = await axios.get(url, { timeout: 15_000 });
      const prices: Array<[number, number]> = resp.data?.prices || [];
      if (prices.length === 0) throw new Error('no prices');

      // Aggregate into 4h closed candles
      const buckets = new Map<number, number[]>();
      for (const [ts, p] of prices) {
        const start = Math.floor(ts / FOUR_H) * FOUR_H;
        const end = start + FOUR_H;
        const lastClosedEnd = Math.floor(Date.now() / FOUR_H) * FOUR_H;
        if (end > lastClosedEnd) continue;
        const arr = buckets.get(start) || [];
        arr.push(p);
        buckets.set(start, arr);
      }

      const candles: Candle[] = [];
      for (const [ts, vals] of buckets) {
        const open = vals[0];
        const close = vals[vals.length - 1];
        candles.push({ timestamp: ts, open, high: Math.max(...vals), low: Math.min(...vals), close, volume: 0 });
      }
      candles.sort((a, b) => a.timestamp - b.timestamp);
      const toInject = candles.slice(-targetCount);
      if (toInject.length >= Math.min(20, targetCount)) {
        this.candleBuilder.injectHistoricalCandles('4h', toInject);
        return true;
      }
    } catch (e) {
      this.logWarn('MarketData', 'CoinGecko 4h bootstrap failed, trying Binance', String(e));
    }

    // Binance fallback
    try {
      const symbol = 'SOLUSDT';
      const limit = Math.min(Math.max(targetCount, 20), 1000);
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=${limit}`;
      const resp = await axios.get(url, { timeout: 10_000 });
      const klines = resp.data || [];
      const candles: Candle[] = klines.map((k: any[]) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) }));
      const toInject = candles.slice(-targetCount);
      if (toInject.length > 0) {
        this.candleBuilder.injectHistoricalCandles('4h', toInject);
        this.logInfo('MarketData', `bootstrapFourHourFromBinance: injected ${toInject.length} 4h candles`);
        return true;
      }
    } catch (e) {
      this.logWarn('MarketData', 'Binance 4h bootstrap failed', String(e));
    }

    return false;
  }

  private async preloadHistoricalPrices(days = 7): Promise<void> {
    const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
    const resp = await axios.get(url, { timeout: 10_000 });
    const prices: Array<[number, number]> = resp.data?.prices || [];
    const sampled: Array<[number, number]> = [];
    let lastTs = 0;
    for (const [ts, price] of prices) {
      if (!price || price <= 0) continue;
      if (lastTs === 0 || ts - lastTs >= 15 * 60 * 1000) { sampled.push([ts, price]); lastTs = ts; }
    }
    for (const [ts, price] of sampled) {
      this.candleBuilder.addTick({ price, timestamp: ts, volume: 0 });
    }
    this.logInfo('MarketData', `preloaded ${sampled.length} ticks`);
  }

  async update(): Promise<void> {
    const now = Date.now();
    try {
      let priceData: PriceData | null = null;
      try { priceData = await this.priceFeed.getPrice(true); } catch (e) { /* try fallback */ }
      if (!priceData) {
        try {
          const resp = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { timeout: 5000 });
          const p = parseFloat(resp.data?.price);
          if (isFinite(p) && p > 0) priceData = { price: p, timestamp: Date.now(), confidence: 0, source: 'binance' };
        } catch (e) { /* ignore */ }
      }

      if (!priceData && this.lastTickPrice && (now - this.lastUpdate) < 60 * 1000) priceData = this.lastTickPrice;
      if (!priceData) priceData = await this.getCurrentPrice();
      if (!priceData) { this.logWarn('MarketData', 'no price available this cycle'); return; }

      this.candleBuilder.addTick({ price: priceData.price, timestamp: now, volume: 0 });
      this.lastUpdate = now;
      this.lastTickPrice = { ...priceData, timestamp: now };
      this.logInfo('MarketData', `CyclePrice ${new Date(now).toISOString()} source=${priceData.source} price=${priceData.price}`);
    } catch (err) {
      this.logWarn('MarketData', 'update error', String(err));
    }
  }

  async getCurrentPrice(force = false): Promise<PriceData> {
    const now = Date.now();
    const freshnessMs = Math.max(30 * 1000, (this.config.timing?.checkInterval || 5000) * 2);
    if (!force && this.lastTickPrice && (now - this.lastUpdate) < freshnessMs) return this.lastTickPrice;
    return await this.priceFeed.getPrice(force);
  }

  getCandles(timeframe: '15m' | '1h' | '4h', count?: number): Candle[] { return this.candleBuilder.getCandles(timeframe, count); }
  getCurrentCandle(timeframe: '15m' | '1h' | '4h'): Candle | null { return this.candleBuilder.getCurrentCandle(timeframe); }
  async checkHealth(): Promise<boolean> { const health = await this.priceFeed.checkPriceHealth(); return health.healthy; }
  getLastUpdateTime(): number { return this.lastUpdate; }
  hasEnoughData(timeframe: '15m' | '1h' | '4h', required: number): boolean { const count = this.candleBuilder.getCandleCount(timeframe); return count >= required; }

}

                      if (candleList.length === 0) {
                        this.logWarn('MarketData', 'bootstrapFourHourMarketContext: built zero 4h candles from API data');
                        return false;
                      }

                      // Sort ascending and take the last `targetCount` closed candles
                      candleList.sort((a, b) => a.timestamp - b.timestamp);
                      const selected = candleList.slice(-targetCount);

                      if (selected.length < Math.min(20, targetCount)) {
                        this.logWarn('MarketData', `bootstrapFourHourMarketContext: insufficient closed 4h candles from CoinGecko (${selected.length}), attempting Binance fallback`);
                        // Try Binance klines fallback which can return exact 4h OHLCV
                        try {
                          const binanceOk = await this.bootstrapFourHourFromBinance(targetCount);
                          if (binanceOk) return true;
                        } catch (err) {
                          this.logWarn('MarketData', 'bootstrapFourHourMarketContext: Binance fallback failed', String(err));
                        }

                        return false;
                      }

                      // If we have at least the requested number, inject only that many
                      const toInject = selected.slice(-targetCount);

                      // Inject as historicalBootstrapData into the CandleBuilder
                      this.candleBuilder.injectHistoricalCandles('4h', toInject);

                      return true;
                    } catch (error) {
                      this.logWarn('MarketData', 'bootstrapFourHourMarketContext: unexpected error', String(error));
                      return false;
                    }
                  }

                  /**
                   * Fallback: fetch 4h OHLCV from Binance public klines API. This is used
                   * when CoinGecko doesn't provide enough closed 4h buckets. Returns true
                   * when at least targetCount closed candles were fetched and injected.
                   */
                  private async bootstrapFourHourFromBinance(targetCount: number): Promise<boolean> {
                    try {
                      if (targetCount <= 0) return false;

                      // Binance uses symbol like SOLUSDT. We prefer SOLUSDC when available,
                      // but SOLUSDT is widely available and close to USD. Use SOLUSDT here.
                      const symbol = 'SOLUSDT';
                      const limit = Math.min(Math.max(targetCount, 20), 1000); // Binance limit up to 1000
                      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=${limit}`;
                      const resp = await axios.get(url, { timeout: 10_000 });

                      if (!Array.isArray(resp.data) || resp.data.length === 0) {
                        this.logWarn('MarketData', 'bootstrapFourHourFromBinance: no klines returned');
                        return false;
                      }

                      // Parse klines: [ openTime, open, high, low, close, volume, closeTime, ... ]
                      const candleList: Candle[] = resp.data.map((k: any[]) => {
                        const openTime = Number(k[0]);
                        const open = Number(k[1]);
                        const high = Number(k[2]);
                        const low = Number(k[3]);
                        const close = Number(k[4]);
                        const volume = Number(k[5]);
                        return { timestamp: openTime, open, high, low, close, volume } as Candle;
                      });

                      if (candleList.length < Math.min(20, targetCount)) {
                        this.logWarn('MarketData', `bootstrapFourHourFromBinance: insufficient klines (${candleList.length})`);
                        return false;
                      }

                      // Binance returns ascending by default; take last targetCount
                      const toInject = candleList.slice(-targetCount);
                      this.candleBuilder.injectHistoricalCandles('4h', toInject);
                      this.logInfo('MarketData', `bootstrapFourHourFromBinance: injected ${toInject.length} 4h candles from Binance`);
                      return true;
                    } catch (err) {
                      this.logWarn('MarketData', 'bootstrapFourHourFromBinance: error', String(err));
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

                      this.logInfo('MarketData', `MarketData: preloaded ${sampled.length} historical ticks from CoinGecko`);
                    } catch (error) {
                      // Bubble up so caller can log fallback behavior; don't crash the bot
                      throw error;
                    }
                  }

                  async update(): Promise<void> {
                    const now = Date.now();
                    // Attempt to fetch a fresh live price each cycle (bypass cache). If
                    // it fails, fall back to the previous lastTickPrice or preloaded data.
                    try {
                      let priceData: PriceData | null = null;
                      try {
                        priceData = await this.priceFeed.getPrice(true);
                      } catch (err) {
                        // Try a direct Binance ticker fallback for a fast live price
                        try {
                          const resp = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { timeout: 5000 });
                          const p = parseFloat(resp.data?.price);
                          if (isFinite(p) && p > 0) {
                            priceData = {
                              price: p,
                              timestamp: Date.now(),
                              confidence: 0,
                              source: 'binance',
                            };
                          }
                        } catch (err2) {
                          // ignore — we'll handle below
                        }
                      }

                      if (!priceData) {
                        // If we couldn't fetch a fresh price, but have a recent lastTickPrice, use it
                        if (this.lastTickPrice && (now - this.lastUpdate) < 60 * 1000) {
                          priceData = this.lastTickPrice;
                        }
                      }

                      if (!priceData) {
                        // Final fallback: try non-forced provider (may return cache)
                        priceData = await this.getCurrentPrice();
                      }

                      if (!priceData) {
                        this.logWarn('MarketData', 'MarketData.update: failed to obtain any reasonable price, skipping tick');
                        return;
                      }

                      const tick: TickData = {
                        price: priceData.price,
                        timestamp: now,
                        volume: 0, // Volume not currently tracked from oracle
                      };

                      this.candleBuilder.addTick(tick);
                      this.lastUpdate = now;
                      this.lastTickPrice = { ...priceData, timestamp: now };

                      // Diagnostic info to help trace which provider produced the price each cycle
                      try {
                        this.logInfo('MarketData', `CyclePrice ${new Date(now).toISOString()} source=${priceData.source} price=${priceData.price}`);
                      } catch (e) {}
                    } catch (err) {
                      this.logWarn('MarketData', 'MarketData.update: unexpected error while fetching price, skipping tick:', String(err));
                    }
                  }

                  async getCurrentPrice(force = false): Promise<PriceData> {
                    // If not forced and we have a recent tick from update(), return it
                    const now = Date.now();
                    const freshnessMs = Math.max(30 * 1000, (this.config.timing?.checkInterval || 5000) * 2);
                    if (!force && this.lastTickPrice && (now - this.lastUpdate) < freshnessMs) {
                      return this.lastTickPrice;
                    }

                    try {
                      return await this.priceFeed.getPrice(force);
                    } catch (err) {
                      // Fallback: use lastTickPrice or last preloaded/current candle price if price feed fails
                      if (this.lastTickPrice) return this.lastTickPrice;

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
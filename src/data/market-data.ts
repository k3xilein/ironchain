import { Config } from '../config';
import { PriceFeed, PriceData } from './price-feed';
import { CandleBuilder, Candle, TickData } from './candle-builder';
import axios from 'axios';

/**
 * MarketData: provides forced live prices each cycle, 4h bootstrap and simple candle helpers.
 */
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

  private logInfo(...args: any[]) { try { console.info(...args); } catch (_) {} }
  private logWarn(...args: any[]) { try { console.warn(...args); } catch (_) {} }

  async initialize(): Promise<void> {
    try { await this.bootstrapFourHourMarketContext(); } catch (e) { this.logWarn('MarketData', '4h bootstrap failed at init', String(e)); }
    // Ensure 15m history is available for entry signals (donchian, RSI etc.)
    try { await this.bootstrapFifteenMinuteMarketContext(); } catch (e) { this.logWarn('MarketData', '15m bootstrap failed at init', String(e)); }
    try { await this.preloadHistoricalPrices(7); } catch (e) { this.logWarn('MarketData', 'preload historical failed at init', String(e)); }
    try { await this.update(); } catch (e) { /* best-effort */ }
  }

  async bootstrapFifteenMinuteMarketContext(count?: number): Promise<boolean> {
    const requiredFromConfig = (this.config?.entry && (this.config.entry as any).donchianPeriod) ? ((this.config.entry as any).donchianPeriod + 50) : 120;
    const targetCount = (typeof count === 'number' && count > 0) ? count : requiredFromConfig;
    if (targetCount <= 0) return false;

    try {
      // Prefer Binance 15m klines for reliable OHLCV history
      const symbol = 'SOLUSDT';
      const limit = Math.min(Math.max(targetCount, 120), 1000);
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=${limit}`;
      const resp = await axios.get(url, { timeout: 10000 });
      if (Array.isArray(resp.data) && resp.data.length > 0) {
        const candleList: Candle[] = resp.data.map((k: any[]) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) } as Candle));
        if (candleList.length >= Math.min(50, targetCount)) {
          const toInject = candleList.slice(-targetCount);
          this.candleBuilder.injectHistoricalCandles('15m', toInject);
          this.logInfo('MarketData', `bootstrapFifteenMinuteMarketContext: injected ${toInject.length} 15m candles from Binance`);
          return true;
        }
      }
    } catch (err) {
      this.logWarn('MarketData', 'bootstrapFifteenMinuteMarketContext: Binance attempt failed', String(err));
    }

    // Fallback to CoinGecko market_chart (per-minute). We'll sample into 15m buckets.
    try {
      const minutesNeeded = Math.ceil((targetCount * 15) / 60 / 24) + 1; // days param
      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${minutesNeeded}`;
      const resp = await axios.get(url, { timeout: 15000 });
      const prices: Array<[number, number]> = resp.data?.prices || [];
      if (Array.isArray(prices) && prices.length > 0) {
        const FIFTEEN = 15 * 60 * 1000;
        const buckets: Map<number, number[]> = new Map();
        const lastClosedEnd = Math.floor(Date.now() / FIFTEEN) * FIFTEEN;
        for (const [ts, p] of prices) {
          const start = Math.floor(ts / FIFTEEN) * FIFTEEN;
          const end = start + FIFTEEN;
          if (end > lastClosedEnd) continue;
          const arr = buckets.get(start) || [];
          arr.push(p);
          buckets.set(start, arr);
        }
        const candleList: Candle[] = [];
        for (const [start, vals] of buckets) {
          if (!vals || vals.length === 0) continue;
          const open = vals[0];
          const close = vals[vals.length - 1];
          candleList.push({ timestamp: start, open, high: Math.max(...vals), low: Math.min(...vals), close, volume: 0 });
        }
        if (candleList.length > 0) {
          candleList.sort((a, b) => a.timestamp - b.timestamp);
          const selected = candleList.slice(-targetCount);
          if (selected.length >= Math.min(50, targetCount)) {
            this.candleBuilder.injectHistoricalCandles('15m', selected);
            this.logInfo('MarketData', `bootstrapFifteenMinuteMarketContext: injected ${selected.length} 15m candles from CoinGecko`);
            return true;
          }
        }
      }
    } catch (err) {
      this.logWarn('MarketData', 'bootstrapFifteenMinuteMarketContext: CoinGecko fallback failed', String(err));
    }

    return false;
  }

  async bootstrapFourHourMarketContext(count?: number): Promise<boolean> {
    const requiredFromConfig = (this.config?.regime && (this.config.regime as any).emaSlow) ? ((this.config.regime as any).emaSlow + 50) : 50;
    const targetCount = (typeof count === 'number' && count > 0) ? count : requiredFromConfig;
    if (targetCount <= 0) return false;

    try {
      const FOUR_H = 4 * 60 * 60 * 1000;
      const days = Math.ceil((targetCount * 4) / 24) + 1;
      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
      const resp = await axios.get(url, { timeout: 15_000 });
      const prices: Array<[number, number]> = resp.data?.prices || [];
      if (!Array.isArray(prices) || prices.length === 0) throw new Error('no prices');

      const FOUR_H_BS: Map<number, number[]> = new Map();
      const lastClosedEnd = Math.floor(Date.now() / FOUR_H) * FOUR_H;
      for (const [ts, p] of prices) {
        const start = Math.floor(ts / FOUR_H) * FOUR_H;
        const end = start + FOUR_H;
        if (end > lastClosedEnd) continue;
        const arr = FOUR_H_BS.get(start) || [];
        arr.push(p);
        FOUR_H_BS.set(start, arr);
      }

      const candleList: Candle[] = [];
      for (const [start, vals] of FOUR_H_BS) {
        if (!vals || vals.length === 0) continue;
        const open = vals[0];
        const close = vals[vals.length - 1];
        candleList.push({ timestamp: start, open, high: Math.max(...vals), low: Math.min(...vals), close, volume: 0 });
      }

      if (candleList.length > 0) {
        candleList.sort((a, b) => a.timestamp - b.timestamp);
        const selected = candleList.slice(-targetCount);
        if (selected.length >= Math.min(20, targetCount)) {
          this.candleBuilder.injectHistoricalCandles('4h', selected);
          this.logInfo('MarketData', `bootstrapFourHourMarketContext: injected ${selected.length} 4h candles from CoinGecko`);
          return true;
        }
      }
    } catch (err) {
      this.logWarn('MarketData', 'bootstrapFourHourMarketContext: CoinGecko attempt failed', String(err));
    }

    return await this.bootstrapFourHourFromBinance(targetCount);
  }

  private async bootstrapFourHourFromBinance(targetCount: number): Promise<boolean> {
    if (targetCount <= 0) return false;
    try {
      const symbol = 'SOLUSDT';
      const limit = Math.min(Math.max(targetCount, 20), 1000);
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=${limit}`;
      const resp = await axios.get(url, { timeout: 10_000 });
      if (!Array.isArray(resp.data) || resp.data.length === 0) return false;
      const candleList: Candle[] = resp.data.map((k: any[]) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) } as Candle));
      if (candleList.length < Math.min(20, targetCount)) return false;
      const toInject = candleList.slice(-targetCount);
      this.candleBuilder.injectHistoricalCandles('4h', toInject);
      this.logInfo('MarketData', `bootstrapFourHourFromBinance: injected ${toInject.length} 4h candles from Binance`);
      return true;
    } catch (err) {
      this.logWarn('MarketData', 'bootstrapFourHourFromBinance: error', String(err));
      return false;
    }
  }

  private async preloadHistoricalPrices(days = 7): Promise<void> {
    try {
      const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
      const resp = await axios.get(url, { timeout: 10_000 });
      const prices: Array<[number, number]> = resp.data?.prices || [];
      if (!Array.isArray(prices) || prices.length === 0) return;
      const sampled: Array<[number, number]> = [];
      let lastTs = 0;
      for (const [ts, price] of prices) {
        if (!price || price <= 0) continue;
        if (lastTs === 0 || ts - lastTs >= 15 * 60 * 1000) { sampled.push([ts, price]); lastTs = ts; }
      }
      for (const [ts, price] of sampled) this.candleBuilder.addTick({ price, timestamp: ts, volume: 0 });
      this.logInfo('MarketData', `preloaded ${sampled.length} ticks`);
    } catch (err) {
      this.logWarn('MarketData', 'preloadHistoricalPrices failed', String(err));
    }
  }

  async update(): Promise<void> {
    const now = Date.now();
    try {
      let priceData: PriceData | null = null;
      try { priceData = await this.priceFeed.getPrice(true); } catch (err) {
        try {
          const resp = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { timeout: 5000 });
          const p = parseFloat(resp.data?.price);
          if (isFinite(p) && p > 0) priceData = { price: p, timestamp: Date.now(), confidence: 0, source: 'binance' };
        } catch (e) { /* ignore */ }
      }

      if (!priceData && this.lastTickPrice && (now - this.lastUpdate) < 60 * 1000) priceData = this.lastTickPrice;
      if (!priceData) {
        try { priceData = await this.getCurrentPrice(); } catch (e) { /* ignore */ }
      }
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
    try { return await this.priceFeed.getPrice(force); } catch (err) {
      if (this.lastTickPrice) return this.lastTickPrice;
      const recent15 = this.candleBuilder.getCurrentCandle('15m') || this.candleBuilder.getCandles('15m').slice(-1)[0];
      if (recent15 && isFinite(recent15.close)) return { price: recent15.close, timestamp: recent15.timestamp, confidence: 0, source: 'preload' } as PriceData;
      throw err;
    }
  }

  getCandles(timeframe: '15m' | '1h' | '4h', count?: number): Candle[] { return this.candleBuilder.getCandles(timeframe, count); }
  getCurrentCandle(timeframe: '15m' | '1h' | '4h'): Candle | null { return this.candleBuilder.getCurrentCandle(timeframe); }
  async checkHealth(): Promise<boolean> { const health = await this.priceFeed.checkPriceHealth(); return health.healthy; }
  getLastUpdateTime(): number { return this.lastUpdate; }
  hasEnoughData(timeframe: '15m' | '1h' | '4h', required: number): boolean { const count = this.candleBuilder.getCandleCount(timeframe); return count >= required; }

}
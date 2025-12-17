import { Config } from '../config';
import { PriceFeed, PriceData } from './price-feed';
import { CandleBuilder, Candle, TickData } from './candle-builder';

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
    // Fetch initial price to populate first candle
    await this.update();
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
    return this.priceFeed.getPrice();
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
import { Timeframe } from '../config';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickData {
  price: number;
  timestamp: number;
  volume?: number;
}

export class CandleBuilder {
  private candles: Map<Timeframe, Candle[]> = new Map();
  private currentCandles: Map<Timeframe, Candle | null> = new Map();
  private maxCandles: number = 1000;

  constructor() {
    // Initialize storage for each timeframe
    const timeframes: Timeframe[] = ['15m', '1h', '4h'];
    for (const tf of timeframes) {
      this.candles.set(tf, []);
      this.currentCandles.set(tf, null);
    }
  }

  addTick(tick: TickData): void {
    const timeframes: Timeframe[] = ['15m', '1h', '4h'];
    
    for (const timeframe of timeframes) {
      this.updateCandle(timeframe, tick);
    }
  }

  private updateCandle(timeframe: Timeframe, tick: TickData): void {
    const candleStart = this.getCandleStartTime(tick.timestamp, timeframe);
    let currentCandle = this.currentCandles.get(timeframe);

    // Check if we need to close current candle and start new one
    if (currentCandle && currentCandle.timestamp !== candleStart) {
      // Close current candle
      this.closeCandle(timeframe, currentCandle);
      currentCandle = null;
    }

    // Create new candle if needed
    if (!currentCandle) {
      currentCandle = {
        timestamp: candleStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume || 0,
      };
      this.currentCandles.set(timeframe, currentCandle);
    } else {
      // Update current candle
      currentCandle.high = Math.max(currentCandle.high, tick.price);
      currentCandle.low = Math.min(currentCandle.low, tick.price);
      currentCandle.close = tick.price;
      currentCandle.volume += tick.volume || 0;
    }
  }

  private closeCandle(timeframe: Timeframe, candle: Candle): void {
    const candleList = this.candles.get(timeframe)!;
    candleList.push(candle);

    // Maintain max candles limit
    if (candleList.length > this.maxCandles) {
      candleList.shift();
    }
  }

  private getCandleStartTime(timestamp: number, timeframe: Timeframe): number {
    const minutes = this.timeframeToMinutes(timeframe);
    const ms = minutes * 60 * 1000;
    return Math.floor(timestamp / ms) * ms;
  }

  private timeframeToMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440,
    };
    return map[timeframe];
  }

  getCandles(timeframe: Timeframe, count?: number): Candle[] {
    const candleList = this.candles.get(timeframe) || [];
    
    if (count) {
      return candleList.slice(-count);
    }
    
    return [...candleList];
  }

  getCurrentCandle(timeframe: Timeframe): Candle | null {
    return this.currentCandles.get(timeframe) || null;
  }

  getCandleCount(timeframe: Timeframe): number {
    return (this.candles.get(timeframe) || []).length;
  }

  // Force close current candle (useful for testing or manual triggers)
  forceCloseCandle(timeframe: Timeframe): void {
    const currentCandle = this.currentCandles.get(timeframe);
    if (currentCandle) {
      this.closeCandle(timeframe, currentCandle);
      this.currentCandles.set(timeframe, null);
    }
  }
}
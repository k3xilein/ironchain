import { Candle } from '../data/candle-builder';
import { RegimeConfig, Regime } from '../config';
import { getLatestEMA, getLatestADX } from './indicators';

export interface RegimeAnalysis {
  regime: Regime;
  confidence: number;
  indicators: {
    price: number;
    ema50: number | null;
    ema200: number | null;
    adx: number | null;
  };
  reasons: string[];
}

export class RegimeFilter {
  private config: RegimeConfig;

  constructor(config: RegimeConfig) {
    this.config = config;
  }

  analyze(candles: Candle[], livePrice?: number): RegimeAnalysis {
    if (candles.length === 0) {
      throw new Error('No candles provided for regime analysis');
    }

    // If a livePrice is provided use it for the regime price comparison so
    // the operator sees decisions that reflect the current market tick. If
    // not provided, fall back to the last closed candle on the regime
    // timeframe (4h) which is the historical baseline.
    const currentPrice = (typeof livePrice === 'number' && isFinite(livePrice)) ? livePrice : candles[candles.length - 1].close;
    const ema50 = getLatestEMA(candles, this.config.emaFast);
    const ema200 = getLatestEMA(candles, this.config.emaSlow);
    const adx = getLatestADX(candles, this.config.adxPeriod);

    const indicators = {
      price: currentPrice,
      ema50,
      ema200,
      adx,
    };

    // Determine regime
    let regime: Regime;
    const reasons: string[] = [];
    let confidence = 0;

    if (!ema50 || !ema200 || !adx) {
      // Not enough data
      regime = 'SIDEWAYS';
      reasons.push('Insufficient data for regime analysis');
      return { regime, confidence: 0, indicators, reasons };
    }

    // Check for BULL regime
    if (currentPrice > ema50 && ema50 > ema200 && adx > this.config.adxThreshold) {
      regime = 'BULL';
      reasons.push(`Price (${currentPrice.toFixed(2)}) > EMA50 (${ema50.toFixed(2)})`);
      reasons.push(`EMA50 (${ema50.toFixed(2)}) > EMA200 (${ema200.toFixed(2)})`);
      reasons.push(`ADX (${adx.toFixed(2)}) > ${this.config.adxThreshold}`);
      
      // Calculate confidence based on trend strength
      const trendGap = (ema50 - ema200) / ema200;
      const adxStrength = Math.min(adx / 40, 1); // Normalize to 0-1
      confidence = (trendGap * 0.5 + adxStrength * 0.5);
      
    } else if (currentPrice < ema50) {
      // Price below EMA50 = BEAR
      regime = 'BEAR';
      reasons.push(`Price (${currentPrice.toFixed(2)}) < EMA50 (${ema50.toFixed(2)})`);
      confidence = Math.min((ema50 - currentPrice) / ema50, 1);
      
    } else if (adx < this.config.adxThreshold) {
      // Low ADX = SIDEWAYS (choppy)
      regime = 'SIDEWAYS';
      reasons.push(`ADX (${adx.toFixed(2)}) < ${this.config.adxThreshold} (weak trend)`);
      confidence = 1 - (adx / this.config.adxThreshold);
      
    } else {
      // Mixed signals = SIDEWAYS
      regime = 'SIDEWAYS';
      reasons.push('Mixed trend signals');
      confidence = 0.5;
    }

    return {
      regime,
      confidence: Math.max(0, Math.min(1, confidence)),
      indicators,
      reasons,
    };
  }

  canTrade(regime: Regime): boolean {
    return regime === 'BULL';
  }
}
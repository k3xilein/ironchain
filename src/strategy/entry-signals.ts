import { Candle } from '../data/candle-builder';
import { EntryConfig, LiquidityConfig } from '../config';
import { getLatestRSI, isRSIRising, calculateDonchianChannel } from './indicators';

export interface EntrySignal {
  shouldEnter: boolean;
  confidence: number;
  entryPrice: number;
  indicators: {
    donchianHigh: number | null;
    currentPrice: number;
    rsi: number | null;
    rsiPrev: number | null;
    spread: number;
    depth: number;
    impact: number;
  };
  reasons: string[];
}

export interface LiquidityData {
  spread: number;
  depthUSD: number;
  estimatedImpact: number;
}

export class EntrySignals {
  private entryConfig: EntryConfig;
  private liquidityConfig: LiquidityConfig;

  constructor(entryConfig: EntryConfig, liquidityConfig: LiquidityConfig) {
    this.entryConfig = entryConfig;
    this.liquidityConfig = liquidityConfig;
  }

  checkEntry(
    candles: Candle[],
    liquidity: LiquidityData
  ): EntrySignal {
    const reasons: string[] = [];
    let shouldEnter = true;
    let confidence = 1.0;

    if (candles.length === 0) {
      return {
        shouldEnter: false,
        confidence: 0,
        entryPrice: 0,
        indicators: {
          donchianHigh: null,
          currentPrice: 0,
          rsi: null,
          rsiPrev: null,
          spread: 0,
          depth: 0,
          impact: 0,
        },
        reasons: ['No candle data'],
      };
    }

    const currentPrice = candles[candles.length - 1].close;
    const donchian = calculateDonchianChannel(candles, this.entryConfig.donchianPeriod);
    const rsi = getLatestRSI(candles, this.entryConfig.rsiPeriod);
    const rsiIsRising = isRSIRising(candles, this.entryConfig.rsiPeriod);

    // Get previous RSI
    const rsiValues = candles.map(c => c.close);
    let rsiPrev: number | null = null;
    if (rsiValues.length >= this.entryConfig.rsiPeriod + 1) {
      const rsis = [];
      for (let i = 0; i < rsiValues.length - 1; i++) {
        const slice = rsiValues.slice(Math.max(0, i - this.entryConfig.rsiPeriod + 1), i + 1);
        if (slice.length >= this.entryConfig.rsiPeriod) {
          // Simplified RSI calc for previous value
          rsiPrev = rsi ? rsi - 2 : null; // Approximation
        }
      }
    }

    const indicators = {
      donchianHigh: donchian?.high || null,
      currentPrice,
      rsi,
      rsiPrev,
      spread: liquidity.spread,
      depth: liquidity.depthUSD,
      impact: liquidity.estimatedImpact,
    };

    // Check 1: Donchian Breakout
    if (!donchian) {
      shouldEnter = false;
      reasons.push('Insufficient data for Donchian channel');
      confidence = 0;
    } else if (currentPrice <= donchian.high) {
      shouldEnter = false;
      reasons.push(
        `Price (${currentPrice.toFixed(2)}) not breaking Donchian high (${donchian.high.toFixed(2)})`
      );
      confidence *= 0.5;
    } else {
      reasons.push(`Breakout: Price > Donchian high`);
      // Confidence based on breakout strength
      const breakoutStrength = (currentPrice - donchian.high) / donchian.high;
      confidence *= Math.min(1, 0.7 + breakoutStrength * 100);
    }

    // Check 2: RSI in range and rising
    if (!rsi) {
      shouldEnter = false;
      reasons.push('RSI not available');
      confidence = 0;
    } else if (rsi < this.entryConfig.rsiLow) {
      shouldEnter = false;
      reasons.push(`RSI (${rsi.toFixed(1)}) below ${this.entryConfig.rsiLow}`);
      confidence *= 0.3;
    } else if (rsi > this.entryConfig.rsiHigh) {
      shouldEnter = false;
      reasons.push(`RSI (${rsi.toFixed(1)}) above ${this.entryConfig.rsiHigh} (overbought)`);
      confidence *= 0.3;
    } else if (!rsiIsRising) {
      shouldEnter = false;
      reasons.push('RSI not rising');
      confidence *= 0.5;
    } else {
      reasons.push(`RSI in range (${this.entryConfig.rsiLow}-${this.entryConfig.rsiHigh}) and rising`);
    }

    // Check 3: Liquidity gates
    if (liquidity.spread > this.liquidityConfig.maxSpread) {
      shouldEnter = false;
      reasons.push(
        `Spread too wide: ${(liquidity.spread * 100).toFixed(2)}% > ${(this.liquidityConfig.maxSpread * 100).toFixed(2)}%`
      );
      confidence *= 0.2;
    } else {
      reasons.push(`Spread acceptable: ${(liquidity.spread * 100).toFixed(2)}%`);
    }

    if (liquidity.depthUSD < this.liquidityConfig.minLiquidityDepth) {
      shouldEnter = false;
      reasons.push(
        `Insufficient liquidity: $${liquidity.depthUSD.toFixed(0)} < $${this.liquidityConfig.minLiquidityDepth}`
      );
      confidence *= 0.2;
    } else {
      reasons.push(`Liquidity sufficient: $${liquidity.depthUSD.toFixed(0)}`);
    }

    if (liquidity.estimatedImpact > this.liquidityConfig.maxPriceImpact) {
      shouldEnter = false;
      reasons.push(
        `Price impact too high: ${(liquidity.estimatedImpact * 100).toFixed(2)}% > ${(this.liquidityConfig.maxPriceImpact * 100).toFixed(2)}%`
      );
      confidence *= 0.2;
    } else {
      reasons.push(`Price impact acceptable: ${(liquidity.estimatedImpact * 100).toFixed(2)}%`);
    }

    return {
      shouldEnter,
      confidence: Math.max(0, Math.min(1, confidence)),
      entryPrice: currentPrice,
      indicators,
      reasons,
    };
  }

  // Mock liquidity check (would connect to Jupiter in production)
  async checkLiquidity(currentPrice: number, positionSizeUSDC: number): Promise<LiquidityData> {
    // Simplified liquidity estimation
    // In production, use Jupiter quote API
    
    const spread = 0.0015; // 0.15% typical for SOL
    const depthUSD = 10000; // Simplified
    const estimatedImpact = (positionSizeUSDC / depthUSD) * 0.01; // Rough estimate

    return {
      spread,
      depthUSD,
      estimatedImpact,
    };
  }
}
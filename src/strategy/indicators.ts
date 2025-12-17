import { EMA, RSI, ADX, ATR } from 'technicalindicators';
import { Candle } from '../data/candle-builder';

export function calculateEMA(candles: Candle[], period: number): number[] {
  const closes = candles.map(c => c.close);
  return EMA.calculate({ period, values: closes });
}

export function getLatestEMA(candles: Candle[], period: number): number | null {
  const emas = calculateEMA(candles, period);
  return emas.length > 0 ? emas[emas.length - 1] : null;
}

export function calculateRSI(candles: Candle[], period: number): number[] {
  const closes = candles.map(c => c.close);
  return RSI.calculate({ period, values: closes });
}

export function getLatestRSI(candles: Candle[], period: number): number | null {
  const rsiValues = calculateRSI(candles, period);
  return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
}

export function calculateADX(candles: Candle[], period: number): any[] {
  const input = {
    close: candles.map(c => c.close),
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    period,
  };
  return ADX.calculate(input);
}

export function getLatestADX(candles: Candle[], period: number): number | null {
  const adxValues = calculateADX(candles, period);
  return adxValues.length > 0 ? adxValues[adxValues.length - 1].adx : null;
}

export function calculateATR(candles: Candle[], period: number): number[] {
  const input = {
    close: candles.map(c => c.close),
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    period,
  };
  return ATR.calculate(input);
}

export function getLatestATR(candles: Candle[], period: number): number | null {
  const atrValues = calculateATR(candles, period);
  return atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
}

export function calculateDonchianChannel(
  candles: Candle[],
  period: number
): { high: number; low: number } | null {
  if (candles.length < period) {
    return null;
  }

  const recentCandles = candles.slice(-period);
  const high = Math.max(...recentCandles.map(c => c.high));
  const low = Math.min(...recentCandles.map(c => c.low));

  return { high, low };
}

export function isRSIRising(candles: Candle[], period: number): boolean {
  const rsiValues = calculateRSI(candles, period);
  
  if (rsiValues.length < 2) {
    return false;
  }

  const current = rsiValues[rsiValues.length - 1];
  const previous = rsiValues[rsiValues.length - 2];

  return current > previous;
}
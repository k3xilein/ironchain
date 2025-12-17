import { Candle } from '../data/candle-builder';
import { ExitConfig } from '../config';
import { getLatestATR, getLatestEMA } from './indicators';

export interface Position {
  entryPrice: number;
  amount: number;
  stopPrice: number;
  entryTime: number;
  partialTaken: boolean;
  trailingStopActive: boolean;
}

export interface ExitSignal {
  shouldExit: boolean;
  exitType: 'stop' | 'partial_tp' | 'trailing' | 'time' | 'none';
  percentage: number; // 0-1 (0.5 = 50%, 1.0 = 100%)
  exitPrice: number;
  newStop?: number;
  reasons: string[];
  rMultiple?: number;
}

export class ExitManager {
  private config: ExitConfig;

  constructor(config: ExitConfig) {
    this.config = config;
  }

  calculateInitialStop(candles: Candle[], entryPrice: number): number {
    const atr = getLatestATR(candles, 14); // Standard 14-period ATR
    
    if (!atr) {
      // Fallback: 2% below entry
      return entryPrice * 0.98;
    }

    const stopDistance = atr * this.config.stopLossATRMultiplier;
    return entryPrice - stopDistance;
  }

  checkExit(position: Position, candles: Candle[], currentPrice: number): ExitSignal {
    const reasons: string[] = [];

    // Calculate current R-multiple
    const risk = position.entryPrice - position.stopPrice;
    const profit = currentPrice - position.entryPrice;
    const rMultiple = profit / risk;

    // Check 1: Stop Loss
    if (currentPrice <= position.stopPrice) {
      return {
        shouldExit: true,
        exitType: 'stop',
        percentage: 1.0,
        exitPrice: currentPrice,
        reasons: [`Stop loss hit at ${position.stopPrice.toFixed(2)}`],
        rMultiple,
      };
    }

    // Check 2: Partial Take Profit (if not already taken)
    if (!position.partialTaken && rMultiple >= this.config.partialTPRMultiple) {
      const newStop = position.entryPrice; // Move to breakeven
      
      return {
        shouldExit: true,
        exitType: 'partial_tp',
        percentage: this.config.partialTPPercent,
        exitPrice: currentPrice,
        newStop,
        reasons: [
          `Partial TP at ${this.config.partialTPRMultiple}R`,
          `Taking ${(this.config.partialTPPercent * 100).toFixed(0)}% profit`,
          `Moving stop to breakeven`,
        ],
        rMultiple,
      };
    }

    // Check 3: Trailing Stop (after partial TP)
    if (position.partialTaken || position.trailingStopActive) {
      const ema = getLatestEMA(candles, this.config.trailingEMAPeriod);
      
      if (ema && currentPrice < ema) {
        return {
          shouldExit: true,
          exitType: 'trailing',
          percentage: 1.0,
          exitPrice: currentPrice,
          reasons: [
            `Trailing stop triggered`,
            `Price (${currentPrice.toFixed(2)}) < EMA${this.config.trailingEMAPeriod} (${ema.toFixed(2)})`,
          ],
          rMultiple,
        };
      }
    }

    // Check 4: Time Exit
    const holdTimeHours = (Date.now() - position.entryTime) / (1000 * 60 * 60);
    
    if (holdTimeHours >= this.config.timeExitHours && rMultiple < this.config.timeExitMinR) {
      return {
        shouldExit: true,
        exitType: 'time',
        percentage: 1.0,
        exitPrice: currentPrice,
        reasons: [
          `Time exit: held for ${holdTimeHours.toFixed(1)}h`,
          `R-multiple (${rMultiple.toFixed(2)}) < ${this.config.timeExitMinR}`,
        ],
        rMultiple,
      };
    }

    // No exit signal
    return {
      shouldExit: false,
      exitType: 'none',
      percentage: 0,
      exitPrice: currentPrice,
      reasons: ['All exit conditions negative'],
      rMultiple,
    };
  }

  updatePosition(position: Position, exitSignal: ExitSignal): Position {
    const updated = { ...position };

    if (exitSignal.exitType === 'partial_tp') {
      updated.partialTaken = true;
      updated.trailingStopActive = true;
      if (exitSignal.newStop) {
        updated.stopPrice = exitSignal.newStop;
      }
      updated.amount *= (1 - exitSignal.percentage);
    }

    return updated;
  }
}
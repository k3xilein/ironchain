import { RiskConfig } from '../config';

export interface PositionSizeParams {
  equity: number;
  entryPrice: number;
  stopPrice: number;
  riskPercent: number;
  maxPositionPercent: number;
}

export interface PositionSize {
  sizeUSDC: number;
  sizeSOL: number;
  potentialLoss: number;
  percentOfEquity: number;
}

export class PositionSizer {
  private config: RiskConfig;

  constructor(config: RiskConfig) {
    this.config = config;
  }

  calculate(params: PositionSizeParams): PositionSize {
    // Risk-based position sizing
    const riskAmount = params.equity * params.riskPercent;
    const stopDistance = Math.abs(params.entryPrice - params.stopPrice);
    
    if (stopDistance === 0) {
      throw new Error('Stop price cannot equal entry price');
    }

    // Calculate position size based on risk
    const riskBasedSize = riskAmount / stopDistance;

    // Apply maximum position cap
    const maxPositionUSDC = params.equity * params.maxPositionPercent;
    const finalSizeUSDC = Math.min(riskBasedSize, maxPositionUSDC);

    // Convert to SOL
    const sizeSOL = finalSizeUSDC / params.entryPrice;

    // Calculate actual potential loss
    const potentialLoss = sizeSOL * stopDistance;

    // Calculate percent of equity
    const percentOfEquity = finalSizeUSDC / params.equity;

    return {
      sizeUSDC: finalSizeUSDC,
      sizeSOL,
      potentialLoss,
      percentOfEquity,
    };
  }

  validateSize(size: PositionSize, equity: number): {
    valid: boolean;
    reason?: string;
  } {
    // Check minimum size
    if (size.sizeUSDC < 10) {
      // Allow a relaxed minimum when running a forced PAPER execution test.
      // This is controlled by environment variables so production behavior
      // is unchanged. In test mode, accept sizes >= $1 so we can validate
      // the execution path end-to-end without large capital.
  // Support a test-only override via FORCE_PAPER_EXECUTE. We check only
  // that env var here (not RUN_MODE) so the relaxation reliably applies
  // when the operator requests a forced paper execution.
  const forceTest = (process.env.FORCE_PAPER_EXECUTE === 'true');
      if (forceTest) {
        if (size.sizeUSDC < 1) {
          return { valid: false, reason: 'Position size too small (min $1 in test mode)' };
        }
      } else {
        return {
          valid: false,
          reason: 'Position size too small (min $10)',
        };
      }
    }

    // Check against max position
    if (size.percentOfEquity > this.config.maxPositionSize) {
      return {
        valid: false,
        reason: `Position exceeds max ${(this.config.maxPositionSize * 100).toFixed(0)}%`,
      };
    }

    // Check potential loss vs risk per trade
    const maxLoss = equity * this.config.riskPerTrade;
    if (size.potentialLoss > maxLoss * 1.1) { // 10% tolerance
      return {
        valid: false,
        reason: 'Potential loss exceeds risk limit',
      };
    }

    return { valid: true };
  }
}
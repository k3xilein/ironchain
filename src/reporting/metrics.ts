import { PositionRecord } from '../logging/database';

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  avgWin: number;
  avgLoss: number;
  avgRMultiple: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  expectancy: number;
}

export function calculateMetrics(positions: PositionRecord[]): PerformanceMetrics {
  const closedPositions = positions.filter(p => p.exitTime !== null && p.exitTime !== undefined);
  
  if (closedPositions.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: 0,
      avgWin: 0,
      avgLoss: 0,
      avgRMultiple: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      expectancy: 0,
    };
  }

  const wins = closedPositions.filter(p => p.outcome === 'win');
  const losses = closedPositions.filter(p => p.outcome === 'loss');

  const totalReturn = closedPositions.reduce((sum, p) => sum + (p.pnlUSDC || 0), 0);
  const grossProfit = wins.reduce((sum, p) => sum + (p.pnlUSDC || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, p) => sum + (p.pnlUSDC || 0), 0));

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  const avgRMultiple = closedPositions.reduce((sum, p) => sum + (p.rMultiple || 0), 0) / closedPositions.length;

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  // Calculate max drawdown
  let peak = 0;
  let maxDD = 0;
  let cumPnL = 0;

  for (const pos of closedPositions) {
    cumPnL += pos.pnlUSDC || 0;
    if (cumPnL > peak) {
      peak = cumPnL;
    }
    const dd = peak - cumPnL;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }

  // Calculate Sharpe ratio (simplified)
  const returns = closedPositions.map(p => (p.pnlPercent || 0) / 100);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  );
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  const expectancy = (avgWin * (wins.length / closedPositions.length)) -
                     (avgLoss * (losses.length / closedPositions.length));

  return {
    totalTrades: closedPositions.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: wins.length / closedPositions.length,
    totalReturn,
    avgWin,
    avgLoss,
    avgRMultiple,
    profitFactor,
    maxDrawdown: maxDD,
    sharpeRatio,
    expectancy,
  };
}
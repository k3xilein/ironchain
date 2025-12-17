import { TradingDatabase } from '../logging/database';
import { calculateMetrics, PerformanceMetrics } from './metrics';

export class ReportGenerator {
  private database: TradingDatabase;

  constructor(database: TradingDatabase) {
    this.database = database;
  }

  generate(): string {
    const positions = this.database.getClosedPositions();
    const metrics = calculateMetrics(positions);

    let report = '';

    report += '╔════════════════════════════════════════╗\n';
    report += '║   IRON CHAIN PERFORMANCE REPORT        ║\n';
    report += '╚════════════════════════════════════════╝\n\n';

    report += '📊 SUMMARY\n';
    report += '─────────────────────────────────────────\n';
    report += `Total Trades:           ${metrics.totalTrades}\n`;
    report += `Winning Trades:         ${metrics.winningTrades} (${(metrics.winRate * 100).toFixed(1)}%)\n`;
    report += `Losing Trades:          ${metrics.losingTrades} (${((1 - metrics.winRate) * 100).toFixed(1)}%)\n\n`;

    report += `Total Return:           ${metrics.totalReturn >= 0 ? '+' : ''}$${metrics.totalReturn.toFixed(2)}\n`;
    report += `Max Drawdown:           $${metrics.maxDrawdown.toFixed(2)}\n\n`;

    report += `Sharpe Ratio:           ${metrics.sharpeRatio.toFixed(2)}\n`;
    report += `Profit Factor:          ${metrics.profitFactor.toFixed(2)}\n`;
    report += `Expectancy:             $${metrics.expectancy.toFixed(2)} per trade\n\n`;

    report += '💰 PROFIT & LOSS\n';
    report += '─────────────────────────────────────────\n';
    report += `Average Win:            $${metrics.avgWin.toFixed(2)}\n`;
    report += `Average Loss:           $${metrics.avgLoss.toFixed(2)}\n`;
    report += `Win/Loss Ratio:         ${(metrics.avgWin / Math.max(metrics.avgLoss, 1)).toFixed(2)}\n\n`;

    report += `Average R-Multiple:     ${metrics.avgRMultiple.toFixed(2)}\n\n`;

    report += '═══════════════════════════════════════════\n';
    report += `Report generated: ${new Date().toISOString()}\n`;
    report += `Database: ${positions.length} closed positions\n`;
    report += '═══════════════════════════════════════════\n';

    return report;
  }

  print(): void {
    console.log(this.generate());
  }
}
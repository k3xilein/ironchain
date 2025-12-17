import { loadConfig } from '../config';
import { TradingDatabase } from '../logging/database';
import * as fs from 'fs';

async function main() {
  try {
    const config = loadConfig();
    const database = new TradingDatabase(config);

    console.log('⛓️  Iron Chain - Status\n');
    console.log('═══════════════════════════════════════\n');

    // Kill switch
    const killActive = fs.existsSync(config.safety.killSwitchFile);
    console.log(`Kill Switch: ${killActive ? '🔴 ACTIVE' : '🟢 Inactive'}`);
    console.log(`Mode: ${config.runMode}\n`);

    // Recent equity
    const equity = database.getEquityCurve(1);
    if (equity.length > 0) {
      const latest = equity[0];
      console.log(`Equity: $${latest.totalEquity.toFixed(2)}`);
      console.log(`SOL: ${latest.solBalance.toFixed(4)}`);
      console.log(`USDC: $${latest.usdcBalance.toFixed(2)}`);
    }

    console.log('\n═══════════════════════════════════════\n');

    database.close();
  } catch (error) {
    console.error('❌ Status check failed:', error);
    process.exit(1);
  }
}

main();
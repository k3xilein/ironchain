import { loadConfig, validateConfig } from '../config';
import { TradingDatabase } from '../logging/database';
import { ReportGenerator } from '../reporting/report-generator';

async function main() {
  try {
    console.log('⛓️  Iron Chain - Performance Report\n');

    const config = loadConfig();
    validateConfig(config);

    const database = new TradingDatabase(config);
    const reportGenerator = new ReportGenerator(database);
    
    reportGenerator.print();

    database.close();

  } catch (error) {
    console.error('❌ Report failed:', error);
    process.exit(1);
  }
}

main();
import { loadConfig } from '../config';
import { TradingDatabase } from '../logging/database';
import * as fs from 'fs';

async function main() {
  const config = loadConfig();
  const database = new TradingDatabase(config);

  const positions = database.getClosedPositions();
  const output = `export-${Date.now()}.json`;

  fs.writeFileSync(output, JSON.stringify(positions, null, 2));

  console.log(`✅ Exported ${positions.length} positions to ${output}`);

  database.close();
}

main();
import { loadConfig } from '../config';
import { testRPCConnection } from '../utils/validation';
import * as fs from 'fs';

async function main() {
  console.log('⛓️  Iron Chain - Health Check\n');

  const config = loadConfig();
  let healthy = true;

  // RPC
  console.log('Checking RPC...');
  const rpcOk = await testRPCConnection(config.network.rpcUrl);
  if (!rpcOk) {
    console.log('  ❌ RPC failed');
    healthy = false;
  } else {
    console.log('  ✅ RPC OK');
  }

  // Logs
  console.log('\nChecking logs...');
  if (fs.existsSync(config.logging.directory)) {
    console.log('  ✅ Log directory OK');
  } else {
    console.log('  ❌ Log directory missing');
    healthy = false;
  }

  console.log('\n' + (healthy ? '✅ Healthy' : '❌ Issues found'));
  process.exit(healthy ? 0 : 1);
}

main();
import { Config, loadConfig, validateConfig } from '../config';
import { IronChainBot } from './bot';
import { MarketData } from '../data/market-data';
import { RegimeFilter } from '../strategy/regime-filter';
import { EntrySignals } from '../strategy/entry-signals';
import { ExitManager } from '../strategy/exit-manager';
import { PositionSizer } from '../risk/position-sizer';
import { RiskManager } from '../risk/risk-manager';
import { KillSwitch } from '../risk/kill-switch';
import { LiveExecutor } from '../execution/live-executor';
import { PaperExecutor } from '../execution/paper-executor';
import { Executor } from '../execution/executor';
import { Logger } from '../logging/logger';
import { AuditLogger } from '../logging/audit-logger';
import { TradingDatabase } from '../logging/database';
import { ReportGenerator } from '../reporting/report-generator';
import { testRPCConnection } from '../utils/validation';
import { PriceFeed } from '../data/price-feed';

export async function startup(): Promise<IronChainBot> {
  console.log('⛓️  Iron Chain - Initializing...\n');

  // Load config
  const config: Config = loadConfig();
  console.log('✅ Configuration loaded');
  console.log(`   Mode: ${config.runMode}`);
  console.log(`   Pair: ${config.trading.pair}`);
  console.log(`   Risk per trade: ${(config.risk.riskPerTrade * 100).toFixed(1)}%\n`);

  // Validate config
  validateConfig(config);
  console.log('✅ Configuration validated\n');

  // Test RPC
  console.log('🔗 Testing RPC connection...');
  const rpcOk = await testRPCConnection(config.network.rpcUrl);
  if (!rpcOk) {
    throw new Error('RPC connection failed');
  }
  console.log('');

  // Initialize logger
  const logger = new Logger(config);
  const auditLogger = new AuditLogger(config);
  const database = new TradingDatabase(config);
  console.log('✅ Logging system initialized\n');

  // Initialize market data
  const marketData = new MarketData(config);
  await marketData.initialize();
  console.log('✅ Market data initialized\n');

  // Initialize strategy components
  const regimeFilter = new RegimeFilter(config.regime);
  const entrySignals = new EntrySignals(config.entry, config.liquidity);
  const exitManager = new ExitManager(config.exit);
  console.log('✅ Strategy components initialized\n');

  // Initialize risk management
  const positionSizer = new PositionSizer(config.risk);
  const riskManager = new RiskManager(config.risk, config.trading.initialCapitalUSDC);
  const killSwitch = new KillSwitch(config);
  console.log('✅ Risk management initialized\n');

  // Initialize executor (live or paper)
  let executor: Executor;
  const priceFeed = new PriceFeed(config);
  
  if (config.runMode === 'MAINNET_LIVE') {
    console.log('⚠️  LIVE MODE - Real trading enabled');
    executor = new LiveExecutor(config);
  } else {
    console.log('📄 PAPER MODE - Simulated trading');
    executor = new PaperExecutor(config, priceFeed);
  }
  
  await executor.initialize();
  console.log('✅ Executor initialized\n');

  // Create bot
  const bot = new IronChainBot({
    config,
    marketData,
    regimeFilter,
    entrySignals,
    exitManager,
    positionSizer,
    riskManager,
    killSwitch,
    executor,
    logger,
    auditLogger,
    database,
  });

  console.log('🚀 Iron Chain ready to start!\n');
  console.log('═══════════════════════════════════════\n');

  return bot;
}

export async function shutdown(bot: IronChainBot): Promise<void> {
  console.log('\n═══════════════════════════════════════');
  console.log('🛑 Initiating shutdown sequence...\n');

  await bot.shutdown();

  console.log('✅ Iron Chain stopped successfully');
  console.log('═══════════════════════════════════════\n');
}

process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Received SIGINT (Ctrl+C)');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Received SIGTERM');
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('\n\n🚨 Unhandled rejection:', error);
  process.exit(1);
});
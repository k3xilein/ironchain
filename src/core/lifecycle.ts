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
import * as readline from 'readline';

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
  // Note: RiskManager initial equity should reflect the real starting
  // portfolio. We will initialize it after the executor is ready so that
  // the high-water-mark is accurate (avoids spurious kill-switch on startup).
  let riskManager: RiskManager;
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

    // Determine starting SOL for paper trading.
    // Prefer environment variable STARTING_SOL for non-interactive/server usage.
    let startingSol = 0;
    const envVal = process.env.STARTING_SOL;
    if (envVal) {
      const parsed = parseFloat(envVal);
      if (!isNaN(parsed) && parsed >= 0) {
        startingSol = parsed;
      }
      console.log(`Using starting SOL from STARTING_SOL env: ${startingSol}`);
    } else if (process.stdin && process.stdin.isTTY) {
      // Interactive prompt only when running in a TTY
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const question = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));
      const answer = await question(`Enter starting SOL amount for Paper Trading (e.g. 1.5) [default 0]: `);
      rl.close();
      const parsed = parseFloat(answer.trim());
      if (!isNaN(parsed) && parsed >= 0) {
        startingSol = parsed;
      }
      console.log(`Using starting SOL (paper): ${startingSol}`);
    } else {
      // Non-interactive and no env var: default to 0
      console.log('No STARTING_SOL provided and not running interactively — using 0 SOL for paper trading');
    }

    executor = new PaperExecutor(config, priceFeed, startingSol);
  }
  
  await executor.initialize();

  // Now that executor is initialized we can determine the actual starting
  // equity (balance + SOL valuation) and initialize the RiskManager so its
  // high-water-mark matches reality.
  try {
    const bal = await executor.getBalance();
    const currentPrice = (await priceFeed.getPrice()).price;
    const initialEquity = bal.usdc + (bal.sol * currentPrice);
    riskManager = new RiskManager(config.risk, initialEquity);
    console.log(`✅ RiskManager initialized with initial equity: ${initialEquity.toFixed(2)} USD`);
  } catch (err) {
    // Fall back to configured initial capital if anything fails
    riskManager = new RiskManager(config.risk, config.trading.initialCapitalUSDC);
    console.warn('RiskManager: failed to derive initial equity from executor — falling back to configured INITIAL_CAPITAL_USDC', String(err));
  }

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
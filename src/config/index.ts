import * as dotenv from 'dotenv';
import { Config, RunMode, Timeframe, LogLevel } from './types';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

export function loadConfig(): Config {
  const runMode = getEnv('RUN_MODE', 'PAPER_LIVE') as RunMode;
  
  const config: Config = {
    runMode,
    
    network: {
      rpcUrl: getEnv('SOLANA_RPC_URL'),
      commitment: getEnv('SOLANA_COMMITMENT', 'confirmed') as any,
      wsUrl: process.env.SOLANA_WS_URL,
    },
    
    wallet: {
      privateKey: getEnv('WALLET_PRIVATE_KEY'),
      address: process.env.WALLET_ADDRESS,
    },
    
    trading: {
      initialCapitalUSDC: getEnvNumber('INITIAL_CAPITAL_USDC', 1000),
      pair: getEnv('TRADING_PAIR', 'SOL/USDC'),
      solMint: getEnv('SOL_MINT', 'So11111111111111111111111111111111111111112'),
      usdcMint: getEnv('USDC_MINT', 'EPjFWdd5AufqSSqeM2qN1xzybapzT7eMu1ouP7C1F51D'),
    },
    
    risk: {
      riskPerTrade: getEnvNumber('RISK_PER_TRADE', 0.01),
      maxPositionSize: getEnvNumber('MAX_POSITION_SIZE', 0.40),
      maxDrawdownPercent: getEnvNumber('MAX_DRAWDOWN_PERCENT', 0.20),
      enableKillSwitch: getEnvBoolean('ENABLE_KILL_SWITCH', true),
      maxSlippage: getEnvNumber('MAX_SLIPPAGE', 0.005),
      minProfitFeeRatio: getEnvNumber('MIN_PROFIT_FEE_RATIO', 3.0),
    },
    
    regime: {
      timeframe: getEnv('REGIME_TIMEFRAME', '4h') as Timeframe,
      emaFast: getEnvNumber('REGIME_EMA_FAST', 50),
      emaSlow: getEnvNumber('REGIME_EMA_SLOW', 200),
      adxPeriod: getEnvNumber('REGIME_ADX_PERIOD', 14),
      adxThreshold: getEnvNumber('REGIME_ADX_THRESHOLD', 20),
    },
    
    entry: {
      timeframe: getEnv('ENTRY_TIMEFRAME', '15m') as Timeframe,
      donchianPeriod: getEnvNumber('ENTRY_DONCHIAN_PERIOD', 20),
      rsiPeriod: getEnvNumber('ENTRY_RSI_PERIOD', 14),
      rsiLow: getEnvNumber('ENTRY_RSI_LOW', 50),
      rsiHigh: getEnvNumber('ENTRY_RSI_HIGH', 75),
    },
    
    exit: {
      stopLossATRMultiplier: getEnvNumber('STOP_LOSS_ATR_MULTIPLIER', 2.5),
      partialTPRMultiple: getEnvNumber('PARTIAL_TP_R_MULTIPLE', 1.5),
      partialTPPercent: getEnvNumber('PARTIAL_TP_PERCENT', 0.50),
      trailingEMAPeriod: getEnvNumber('TRAILING_EMA_PERIOD', 20),
      timeExitHours: getEnvNumber('TIME_EXIT_HOURS', 12),
      timeExitMinR: getEnvNumber('TIME_EXIT_MIN_R', 1.0),
    },
    
    liquidity: {
      maxSpread: getEnvNumber('MAX_SPREAD', 0.002),
      minLiquidityDepth: getEnvNumber('MIN_LIQUIDITY_DEPTH', 5000),
      maxPriceImpact: getEnvNumber('MAX_PRICE_IMPACT', 0.01),
    },
    
    oracle: {
      pythPriceFeed: getEnv('PYTH_PRICE_FEED'),
      maxPriceStaleness: getEnvNumber('MAX_PRICE_STALENESS', 60),
      maxOracleDivergence: getEnvNumber('MAX_ORACLE_DIVERGENCE', 0.01),
    },
    
    timing: {
      checkInterval: getEnvNumber('CHECK_INTERVAL', 5000),
      candleCloseDelay: getEnvNumber('CANDLE_CLOSE_DELAY', 2000),
      txConfirmationTimeout: getEnvNumber('TX_CONFIRMATION_TIMEOUT', 30000),
      priceCacheTTL: getEnvNumber('PRICE_CACHE_TTL', 30000),
      heartbeatIntervalMs: getEnvNumber('HEARTBEAT_INTERVAL_MS', 150000),
    },
    
    logging: {
      level: getEnv('LOG_LEVEL', 'info') as LogLevel,
      toFile: getEnvBoolean('LOG_TO_FILE', true),
      toConsole: getEnvBoolean('LOG_TO_CONSOLE', true),
      directory: getEnv('LOG_DIRECTORY', './logs'),
      maxFileSize: getEnvNumber('MAX_LOG_FILE_SIZE', 100),
      enableAuditLog: getEnvBoolean('ENABLE_AUDIT_LOG', true),
    },
    
    database: {
      path: getEnv('DATABASE_PATH', './data/trades.db'),
      enabled: getEnvBoolean('ENABLE_DATABASE', true),
      vacuumInterval: getEnvNumber('DB_VACUUM_INTERVAL', 1000),
    },
    
    safety: {
      enableBalanceCheck: getEnvBoolean('ENABLE_BALANCE_CHECK', true),
      enableRPCHealthCheck: getEnvBoolean('ENABLE_RPC_HEALTH_CHECK', true),
      rpcHealthCheckInterval: getEnvNumber('RPC_HEALTH_CHECK_INTERVAL', 60000),
      enableOracleHealthCheck: getEnvBoolean('ENABLE_ORACLE_HEALTH_CHECK', true),
      killSwitchFile: getEnv('KILL_SWITCH_FILE', './STOP_AND_FLATTEN'),
    },
    
    paperMode: {
      feePercent: getEnvNumber('PAPER_FEE_PERCENT', 0.002),
      slippageBase: getEnvNumber('PAPER_SLIPPAGE_BASE', 0.001),
      slippageScaling: getEnvNumber('PAPER_SLIPPAGE_SCALING', 0.0001),
      enableDelays: getEnvBoolean('PAPER_ENABLE_DELAYS', true),
    },
  };
  
  return config;
}

export function validateConfig(config: Config): void {
  // Network validation
  if (!config.network.rpcUrl.startsWith('https://')) {
    throw new Error('RPC URL must use HTTPS');
  }
  
  // Trading pair validation
  if (config.trading.pair !== 'SOL/USDC') {
    throw new Error('Only SOL/USDC pair is currently supported');
  }
  
  if (config.trading.initialCapitalUSDC <= 0) {
    throw new Error('Initial capital must be positive');
  }
  
  // Risk validation
  if (config.risk.riskPerTrade <= 0 || config.risk.riskPerTrade > 0.05) {
    throw new Error('riskPerTrade must be between 0 and 5%');
  }
  
  if (config.risk.maxPositionSize <= 0 || config.risk.maxPositionSize > 1.0) {
    throw new Error('maxPositionSize must be between 0 and 100%');
  }
  
  if (config.risk.maxDrawdownPercent <= 0 || config.risk.maxDrawdownPercent > 1.0) {
    throw new Error('maxDrawdownPercent must be between 0 and 100%');
  }
  
  // Strategy validation
  if (config.regime.timeframe !== '4h') {
    throw new Error('Regime timeframe must be 4h');
  }
  
  if (config.entry.timeframe !== '15m') {
    throw new Error('Entry timeframe must be 15m');
  }
  
  if (config.entry.rsiLow >= config.entry.rsiHigh) {
    throw new Error('RSI low must be less than RSI high');
  }
  
  // Create necessary directories
  const dirs = [
    config.logging.directory,
    path.dirname(config.database.path),
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export * from './types';
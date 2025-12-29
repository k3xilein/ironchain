export type RunMode = 'MAINNET_LIVE' | 'PAPER_LIVE' | 'DEVNET_LIVE';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type Regime = 'BULL' | 'BEAR' | 'SIDEWAYS';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface NetworkConfig {
  rpcUrl: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  wsUrl?: string;
}

export interface WalletConfig {
  privateKey: string;
  address?: string;
}

export interface TradingConfig {
  initialCapitalUSDC: number;
  pair: string;
  solMint: string;
  usdcMint: string;
}

export interface RiskConfig {
  riskPerTrade: number;
  maxPositionSize: number;
  maxDrawdownPercent: number;
  enableKillSwitch: boolean;
  maxSlippage: number;
  minProfitFeeRatio: number;
}

export interface RegimeConfig {
  timeframe: Timeframe;
  emaFast: number;
  emaSlow: number;
  adxPeriod: number;
  adxThreshold: number;
}

export interface EntryConfig {
  timeframe: Timeframe;
  donchianPeriod: number;
  rsiPeriod: number;
  rsiLow: number;
  rsiHigh: number;
}

export interface ExitConfig {
  stopLossATRMultiplier: number;
  partialTPRMultiple: number;
  partialTPPercent: number;
  trailingEMAPeriod: number;
  timeExitHours: number;
  timeExitMinR: number;
}

export interface LiquidityConfig {
  maxSpread: number;
  minLiquidityDepth: number;
  maxPriceImpact: number;
}

export interface OracleConfig {
  pythPriceFeed: string;
  maxPriceStaleness: number;
  maxOracleDivergence: number;
}

export interface TimingConfig {
  checkInterval: number;
  candleCloseDelay: number;
  txConfirmationTimeout: number;
  // Milliseconds to cache latest fetched USD price before refreshing
  priceCacheTTL?: number;
  // Heartbeat interval in milliseconds (default ~2.5 minutes)
  heartbeatIntervalMs?: number;
}

export interface LoggingConfig {
  level: LogLevel;
  toFile: boolean;
  toConsole: boolean;
  directory: string;
  maxFileSize: number;
  enableAuditLog: boolean;
}

export interface DatabaseConfig {
  path: string;
  enabled: boolean;
  vacuumInterval: number;
}

export interface SafetyConfig {
  enableBalanceCheck: boolean;
  enableRPCHealthCheck: boolean;
  rpcHealthCheckInterval: number;
  enableOracleHealthCheck: boolean;
  killSwitchFile: string;
}

export interface PaperModeConfig {
  feePercent: number;
  slippageBase: number;
  slippageScaling: number;
  enableDelays: boolean;
}

export interface Config {
  runMode: RunMode;
  network: NetworkConfig;
  wallet: WalletConfig;
  trading: TradingConfig;
  risk: RiskConfig;
  regime: RegimeConfig;
  entry: EntryConfig;
  exit: ExitConfig;
  liquidity: LiquidityConfig;
  oracle: OracleConfig;
  timing: TimingConfig;
  logging: LoggingConfig;
  database: DatabaseConfig;
  safety: SafetyConfig;
  paperMode: PaperModeConfig;
}
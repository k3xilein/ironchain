export interface ExecutionResult {
  success: boolean;
  price: number;
  amount: number;
  fee: number;
  slippage: number;
  txHash: string;
  timestamp: number;
  error?: string;
}

export interface Balance {
  sol: number;
  usdc: number;
}

export interface Executor {
  buy(amountUSDC: number, maxSlippage: number): Promise<ExecutionResult>;
  sell(amountSOL: number, maxSlippage: number): Promise<ExecutionResult>;
  getBalance(): Promise<Balance>;
  initialize(): Promise<void>;
}
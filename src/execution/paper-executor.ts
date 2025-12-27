import { Config } from '../config';
import { Executor, ExecutionResult, Balance } from './executor';
import { PriceFeed } from '../data/price-feed';

export class PaperExecutor implements Executor {
  private balance: Balance;
  private config: Config;
  private priceFeed: PriceFeed;
  private tradeCount: number = 0;
  // startingSol allows initializing the paper wallet with a given SOL amount
  constructor(config: Config, priceFeed: PriceFeed, startingSol?: number) {
    this.config = config;
    this.priceFeed = priceFeed;
    
    // Initialize with starting capital
    this.balance = {
      sol: startingSol || 0,
      usdc: config.trading.initialCapitalUSDC,
    };
  }

  async initialize(): Promise<void> {
    console.log('Paper executor initialized with:', this.balance);
  }

  async buy(amountUSDC: number, maxSlippage: number): Promise<ExecutionResult> {
    try {
      // Check balance
      if (this.balance.usdc < amountUSDC) {
        throw new Error(`Insufficient USDC balance: ${this.balance.usdc} < ${amountUSDC}`);
      }

      // Get current price
      const priceData = await this.priceFeed.getPrice();
      let executionPrice = priceData.price;

      // Simulate slippage (increases with position size)
      const slippage = this.calculateRealisticSlippage(amountUSDC);
      executionPrice *= (1 + slippage);

      // Ensure within slippage tolerance
      if (slippage > maxSlippage) {
        throw new Error(`Slippage ${(slippage * 100).toFixed(2)}% exceeds max ${(maxSlippage * 100).toFixed(2)}%`);
      }

      // Simulate fee
      const fee = amountUSDC * this.config.paperMode.feePercent;

      // Calculate amounts
      const amountAfterFee = amountUSDC - fee;
      const solReceived = amountAfterFee / executionPrice;

      // Update balance
      this.balance.usdc -= amountUSDC;
      this.balance.sol += solReceived;

      // Simulate delay
      if (this.config.paperMode.enableDelays) {
        await this.simulateDelay();
      }

      this.tradeCount++;

      return {
        success: true,
        price: executionPrice,
        amount: solReceived,
        fee,
        slippage,
        txHash: `PAPER_BUY_${Date.now()}_${this.tradeCount}`,
        timestamp: Date.now(),
      };

    } catch (error) {
      return {
        success: false,
        price: 0,
        amount: 0,
        fee: 0,
        slippage: 0,
        txHash: '',
        timestamp: Date.now(),
        error: String(error),
      };
    }
  }

  async sell(amountSOL: number, maxSlippage: number): Promise<ExecutionResult> {
    try {
      // Check balance
      if (this.balance.sol < amountSOL) {
        throw new Error(`Insufficient SOL balance: ${this.balance.sol} < ${amountSOL}`);
      }

      // Get current price
      const priceData = await this.priceFeed.getPrice();
      let executionPrice = priceData.price;

      // Simulate slippage (negative for sells)
      const slippage = this.calculateRealisticSlippage(amountSOL * executionPrice);
      executionPrice *= (1 - slippage);

      // Ensure within slippage tolerance
      if (slippage > maxSlippage) {
        throw new Error(`Slippage ${(slippage * 100).toFixed(2)}% exceeds max ${(maxSlippage * 100).toFixed(2)}%`);
      }

      // Calculate USDC received
      const usdcReceived = amountSOL * executionPrice;

      // Simulate fee
      const fee = usdcReceived * this.config.paperMode.feePercent;
      const usdcAfterFee = usdcReceived - fee;

      // Update balance
      this.balance.sol -= amountSOL;
      this.balance.usdc += usdcAfterFee;

      // Simulate delay
      if (this.config.paperMode.enableDelays) {
        await this.simulateDelay();
      }

      this.tradeCount++;

      return {
        success: true,
        price: executionPrice,
        amount: usdcAfterFee,
        fee,
        slippage,
        txHash: `PAPER_SELL_${Date.now()}_${this.tradeCount}`,
        timestamp: Date.now(),
      };

    } catch (error) {
      return {
        success: false,
        price: 0,
        amount: 0,
        fee: 0,
        slippage: 0,
        txHash: '',
        timestamp: Date.now(),
        error: String(error),
      };
    }
  }

  async getBalance(): Promise<Balance> {
    return { ...this.balance };
  }

  private calculateRealisticSlippage(orderSizeUSDC: number): number {
    // Base slippage
    let slippage = this.config.paperMode.slippageBase;

    // Add size-dependent slippage
    // Larger orders = more slippage
    const sizeFactor = orderSizeUSDC / 1000; // Every $1000 adds scaling factor
    slippage += sizeFactor * this.config.paperMode.slippageScaling;

    // Add random component for realism
    const randomFactor = (Math.random() - 0.5) * 0.0002; // ±0.02%
    slippage += randomFactor;

    return Math.max(0, slippage);
  }

  private async simulateDelay(): Promise<void> {
    // Simulate blockchain confirmation delay (1-3 seconds)
    const delay = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Additional helper for paper mode
  getTotalEquity(currentPrice: number): number {
    return this.balance.usdc + (this.balance.sol * currentPrice);
  }
}
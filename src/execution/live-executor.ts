import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from '../config';
import { Executor, ExecutionResult, Balance } from './executor';
import { JupiterClient } from './jupiter-client';
import bs58 from 'bs58';

export class LiveExecutor implements Executor {
  private connection: Connection;
  private wallet: Keypair;
  private jupiterClient: JupiterClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.connection = new Connection(config.network.rpcUrl, config.network.commitment);
    
    // Decode private key
    const privateKeyBytes = bs58.decode(config.wallet.privateKey);
    this.wallet = Keypair.fromSecretKey(privateKeyBytes);
    
    this.jupiterClient = new JupiterClient(this.connection, this.wallet);
  }

  async initialize(): Promise<void> {
    // Test connection
    const version = await this.connection.getVersion();
    console.log('Connected to Solana:', version);
    
    // Check balance
    const balance = await this.getBalance();
    console.log('Wallet balance:', balance);
  }

  async buy(amountUSDC: number, maxSlippage: number): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Convert USDC to lamports (6 decimals)
      const amountLamports = Math.floor(amountUSDC * 1e6);

      // Get quote from Jupiter
      const quote = await this.jupiterClient.getQuote({
        inputMint: this.config.trading.usdcMint,
        outputMint: this.config.trading.solMint,
        amount: amountLamports,
        slippageBps: maxSlippage * 10000, // Convert to basis points
      });

      // Calculate metrics
      const outAmount = Number(quote.outAmount) / 1e9; // SOL has 9 decimals
      const executionPrice = amountUSDC / outAmount;
      const priceImpact = parseFloat(quote.priceImpactPct);

      // Execute swap
      const txHash = await this.jupiterClient.executeSwap(quote);

      // Estimate fee (Jupiter typically 0.2%)
      const fee = amountUSDC * 0.002;
      const slippage = Math.abs(priceImpact);

      return {
        success: true,
        price: executionPrice,
        amount: outAmount,
        fee,
        slippage,
        txHash,
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
    const startTime = Date.now();

    try {
      // Convert SOL to lamports (9 decimals)
      const amountLamports = Math.floor(amountSOL * 1e9);

      // Get quote from Jupiter
      const quote = await this.jupiterClient.getQuote({
        inputMint: this.config.trading.solMint,
        outputMint: this.config.trading.usdcMint,
        amount: amountLamports,
        slippageBps: maxSlippage * 10000,
      });

      // Calculate metrics
      const outAmount = Number(quote.outAmount) / 1e6; // USDC has 6 decimals
      const executionPrice = outAmount / amountSOL;
      const priceImpact = parseFloat(quote.priceImpactPct);

      // Execute swap
      const txHash = await this.jupiterClient.executeSwap(quote);

      // Estimate fee
      const fee = outAmount * 0.002;
      const slippage = Math.abs(priceImpact);

      return {
        success: true,
        price: executionPrice,
        amount: outAmount,
        fee,
        slippage,
        txHash,
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
    try {
      // Get SOL balance
      const solBalance = await this.connection.getBalance(this.wallet.publicKey);
      const sol = solBalance / 1e9;

      // Get USDC token balance
      const usdcMint = new PublicKey(this.config.trading.usdcMint);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { mint: usdcMint }
      );

      let usdc = 0;
      if (tokenAccounts.value.length > 0) {
        const usdcAccount = tokenAccounts.value[0];
        usdc = usdcAccount.account.data.parsed.info.tokenAmount.uiAmount;
      }

      return { sol, usdc };

    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }
}
import axios from 'axios';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapResponse {
  swapTransaction: string;
}

export class JupiterClient {
  private connection: Connection;
  private wallet: Keypair;
  private apiUrl: string = 'https://quote-api.jup.ag/v6';

  constructor(connection: Connection, wallet: Keypair) {
    this.connection = connection;
    this.wallet = wallet;
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<JupiterQuote> {
    try {
      const response = await axios.get(`${this.apiUrl}/quote`, {
        params: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(`Jupiter quote failed: ${error}`);
    }
  }

  async getSwapTransaction(quote: JupiterQuote): Promise<string> {
    try {
      const response = await axios.post<JupiterSwapResponse>(`${this.apiUrl}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
      });

      return response.data.swapTransaction;
    } catch (error) {
      throw new Error(`Jupiter swap transaction failed: ${error}`);
    }
  }

  async executeSwap(quote: JupiterQuote): Promise<string> {
    try {
      // Get swap transaction
      const swapTransactionBase64 = await this.getSwapTransaction(quote);

      // Deserialize transaction
      const swapTransactionBuf = Buffer.from(swapTransactionBase64, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Sign transaction
      transaction.sign([this.wallet]);

      // Send transaction
      const rawTransaction = transaction.serialize();
      const txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm transaction
      await this.connection.confirmTransaction(txid, 'confirmed');

      return txid;
    } catch (error) {
      throw new Error(`Jupiter swap execution failed: ${error}`);
    }
  }
}
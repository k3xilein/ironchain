import { Connection, PublicKey } from '@solana/web3.js';
import { Config } from '../config';
import axios from 'axios';

export interface PriceData {
  price: number;
  timestamp: number;
  confidence: number;
  source: 'pyth' | 'jupiter';
}

export class PriceFeed {
  private connection: Connection;
  private pythPriceFeed: PublicKey;
  private config: Config;
  private cachedPrice: PriceData | null = null;
  private lastUpdateTime: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.connection = new Connection(config.network.rpcUrl, config.network.commitment);
    this.pythPriceFeed = new PublicKey(config.oracle.pythPriceFeed);
  }

  async getPrice(): Promise<PriceData> {
    // Return cached price if fresh enough
    const now = Date.now();
    if (this.cachedPrice && (now - this.lastUpdateTime) < 5000) {
      return this.cachedPrice;
    }

    try {
      // Try Pyth first
      const pythPrice = await this.getPythPrice();
      
      if (pythPrice) {
        this.cachedPrice = pythPrice;
        this.lastUpdateTime = now;
        return pythPrice;
      }

      // Fallback to Jupiter
      const jupiterPrice = await this.getJupiterPrice();
      this.cachedPrice = jupiterPrice;
      this.lastUpdateTime = now;
      return jupiterPrice;

    } catch (error) {
      throw new Error(`Failed to fetch price: ${error}`);
    }
  }

  private async getPythPrice(): Promise<PriceData | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(this.pythPriceFeed);
      
      if (!accountInfo) {
        return null;
      }

      // Parse Pyth price account data
      // Pyth price is stored at offset 208 (8 bytes)
      // Confidence is at offset 216 (8 bytes)
      // Expo is at offset 224 (4 bytes)
      // Publish time is at offset 228 (8 bytes)
      
      const data = accountInfo.data;
      const price = data.readBigInt64LE(208);
      const confidence = data.readBigInt64LE(216);
      const expo = data.readInt32LE(224);
      const publishTime = Number(data.readBigInt64LE(228));

      // Check staleness
      const age = Date.now() / 1000 - publishTime;
      if (age > this.config.oracle.maxPriceStaleness) {
        console.warn(`Pyth price stale: ${age}s old`);
        return null;
      }

      // Convert to decimal
      const priceDecimal = Number(price) * Math.pow(10, expo);
      const confidenceDecimal = Number(confidence) * Math.pow(10, expo);

      return {
        price: priceDecimal,
        timestamp: publishTime * 1000,
        confidence: confidenceDecimal,
        source: 'pyth',
      };

    } catch (error) {
      console.warn('Pyth price fetch failed:', error);
      return null;
    }
  }

  private async getJupiterPrice(): Promise<PriceData> {
    try {
      // Jupiter price API v6
      const response = await axios.get(
        `https://price.jup.ag/v6/price?ids=${this.config.trading.solMint}`,
        { timeout: 5000 }
      );

      const priceData = response.data.data[this.config.trading.solMint];
      
      if (!priceData) {
        throw new Error('No price data from Jupiter');
      }

      return {
        price: priceData.price,
        timestamp: Date.now(),
        confidence: 0, // Jupiter doesn't provide confidence
        source: 'jupiter',
      };

    } catch (error) {
      throw new Error(`Jupiter price fetch failed: ${error}`);
    }
  }

  async checkPriceHealth(): Promise<{
    healthy: boolean;
    pythPrice?: number;
    jupiterPrice?: number;
    divergence?: number;
  }> {
    try {
      const [pythPrice, jupiterPrice] = await Promise.all([
        this.getPythPrice(),
        this.getJupiterPrice(),
      ]);

      if (!pythPrice) {
        return { healthy: false };
      }

      const divergence = Math.abs(pythPrice.price - jupiterPrice.price) / pythPrice.price;

      return {
        healthy: divergence < this.config.oracle.maxOracleDivergence,
        pythPrice: pythPrice.price,
        jupiterPrice: jupiterPrice.price,
        divergence,
      };

    } catch (error) {
      return { healthy: false };
    }
  }
}
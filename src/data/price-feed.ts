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
    // Prefer CoinGecko for a straightforward USD price (reliable HTTP API).
    // Fall back to Jupiter, then Pyth if needed. This ordering avoids
    // Pyth binary parsing issues when a simple HTTP price is available.
    try {
      const cg = await this.getCoinGeckoPrice();
      if (this.isPriceReasonable(cg.price)) {
        this.cachedPrice = cg;
        this.lastUpdateTime = now;
        return cg;
      }
    } catch (err) {
      console.warn('CoinGecko price fetch failed or returned unreasonable value, trying Jupiter/Pyth', String(err));
    }

    try {
      const jupiterPrice = await this.getJupiterPrice();
      if (this.isPriceReasonable(jupiterPrice.price)) {
        this.cachedPrice = jupiterPrice;
        this.lastUpdateTime = now;
        return jupiterPrice;
      }
    } catch (err) {
      console.warn('Jupiter price fetch failed or returned unreasonable value, falling back to Pyth', String(err));
    }

    try {
      const pythPrice = await this.getPythPrice();
      if (pythPrice && this.isPriceReasonable(pythPrice.price)) {
        this.cachedPrice = pythPrice;
        this.lastUpdateTime = now;
        return pythPrice;
      }
    } catch (err) {
      console.warn('Pyth price fetch failed or returned unreasonable value', String(err));
    }

    throw new Error('Failed to fetch a reasonable price from CoinGecko, Jupiter or Pyth');
  }

  private async getCoinGeckoPrice(): Promise<PriceData> {
    try {
      const resp = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 5000 });
      const price = resp.data?.solana?.usd;
      if (!price || typeof price !== 'number') throw new Error('Invalid CoinGecko response');
      return { price, timestamp: Date.now(), confidence: 0, source: 'jupiter' as any };
    } catch (err) {
      throw new Error(`CoinGecko price fetch failed: ${String(err)}`);
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

      // Basic sanity check — if the parsed price is absurdly large/small, return null
      if (!this.isPriceReasonable(priceDecimal)) {
        console.warn(`Parsed Pyth price unreasonable: ${priceDecimal}`);
        return null;
      }

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

  private isPriceReasonable(price: number): boolean {
    // SOL shouldn't cost fractions of a cent or trillions of USD. Use broad bounds.
    if (!isFinite(price) || price <= 0) return false;
    if (price < 0.001) return false; // <0.1 cent
    if (price > 1_000_000) return false; // > $1M per SOL is unrealistic
    return true;
  }
}
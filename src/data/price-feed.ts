import { Connection, PublicKey } from '@solana/web3.js';
import { Config } from '../config';
import axios from 'axios';

export interface PriceData {
  price: number;
  timestamp: number;
  confidence: number;
  source: 'pyth' | 'jupiter' | 'coingecko' | 'binance' | 'preload';
}

export class PriceFeed {
  private connection: Connection;
  private pythPriceFeed: PublicKey;
  private config: Config;
  private cachedPrice: PriceData | null = null;
  private lastUpdateTime: number = 0;
  private cacheTTL: number = 30 * 1000; // default 30s cache
  // Pyth clamp bounds (USD)
  private readonly PYTH_MIN_PRICE = 0.01; // $0.01
  private readonly PYTH_MAX_PRICE = 10_000; // $10k

  constructor(config: Config) {
    this.config = config;
    this.connection = new Connection(config.network.rpcUrl, config.network.commitment);
    this.pythPriceFeed = new PublicKey(config.oracle.pythPriceFeed);
    // Allow overriding cache TTL via config.timing.priceCacheTTL (ms)
    if (config.timing && typeof (config.timing as any).priceCacheTTL === 'number') {
      this.cacheTTL = (config.timing as any).priceCacheTTL;
    }
  }

  async getPrice(force = false): Promise<PriceData> {
    // Return cached price if fresh enough (unless force=true)
    const now = Date.now();
    if (!force && this.cachedPrice && (now - this.lastUpdateTime) < this.cacheTTL) {
      return this.cachedPrice;
    }
    // Prefer Binance for low-latency, low-rate-limit ticker queries.
    // Fall back to CoinGecko (with a small retry/backoff) then Jupiter and Pyth.
    try {
      const bin = await this.getBinancePrice();
      if (bin && this.isPriceReasonable(bin.price)) {
        this.cachedPrice = bin;
        this.lastUpdateTime = now;
        return bin;
      }
    } catch (err) {
      if (this.cachedPrice && !force) {
        console.warn('Binance fetch failed; returning cached price', String(err));
        return this.cachedPrice;
      }
      // fall through to try CoinGecko/Jupiter/Pyth
    }

    // Try CoinGecko next but with a short retry/backoff to gracefully handle 429s
    try {
      const cg = await this.getCoinGeckoPriceWithRetry(2);
      if (cg && this.isPriceReasonable(cg.price)) {
        this.cachedPrice = cg;
        this.lastUpdateTime = now;
        return cg;
      }
    } catch (err) {
      if (this.cachedPrice && !force) {
        console.warn('CoinGecko fetch failed; returning cached price', String(err));
        return this.cachedPrice;
      }
      // fall through to try Jupiter/Pyth
      console.warn('CoinGecko price fetch failed or returned unreasonable value, trying Jupiter/Pyth');
    }

    try {
      const jupiterPrice = await this.getJupiterPrice();
      if (this.isPriceReasonable(jupiterPrice.price)) {
        this.cachedPrice = jupiterPrice;
        this.lastUpdateTime = now;
        return jupiterPrice;
      }
    } catch (err) {
      if (this.cachedPrice && !force) {
        console.warn('Jupiter fetch failed; returning cached price', String(err));
        return this.cachedPrice;
      }
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
      if (this.cachedPrice && !force) {
        console.warn('Pyth fetch failed; returning cached price', String(err));
        return this.cachedPrice;
      }
      console.warn('Pyth price fetch failed or returned unreasonable value', String(err));
    }

    // If all providers failed and we have no cached price, throw — caller
    // should handle this and decide whether to stop. This is a last-resort
    // failure mode.
    throw new Error('Failed to fetch a reasonable price from CoinGecko, Jupiter or Pyth');
  }

  private async getCoinGeckoPrice(): Promise<PriceData> {
    const resp = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 5000 });
    const price = resp.data?.solana?.usd;
    if (!price || typeof price !== 'number') throw new Error('Invalid CoinGecko response');
    return { price, timestamp: Date.now(), confidence: 0, source: 'coingecko' };
  }

  private async getCoinGeckoPriceWithRetry(attempts = 2): Promise<PriceData> {
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.getCoinGeckoPrice();
      } catch (err: any) {
        lastErr = err;
        // If rate limited, wait a bit and retry with exponential backoff
        const status = err?.response?.status || null;
        if (status === 429) {
          const backoff = 300 * Math.pow(2, i); // 300ms, 600ms, ...
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        // Non-429 errors: don't spam retries
        break;
      }
    }
    throw new Error(`CoinGecko price fetch failed after ${attempts} attempts: ${String(lastErr)}`);
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

      // Reject obviously-suspicious exponent values. Pyth typically uses a
      // small negative exponent (e.g. -8). If expo is positive or absurdly
      // large in magnitude the parsed result will be nonsensical; treat as
      // invalid so we fall back to HTTP providers instead of clamping.
      if (!Number.isInteger(expo) || expo > 0 || Math.abs(expo) > 12) {
        console.warn(`Pyth expo looks suspicious: ${expo}`);
        return null;
      }

      // Convert to decimal
      const priceDecimal = Number(price) * Math.pow(10, expo);
      const confidenceDecimal = Number(confidence) * Math.pow(10, expo);

      // Clamp Pyth price to reasonable bounds to protect against parsing anomalies
      let clampedPrice = priceDecimal;
      if (!isFinite(clampedPrice) || clampedPrice <= 0) {
        console.warn(`Parsed Pyth price invalid: ${priceDecimal}`);
        return null;
      }

      if (clampedPrice < this.PYTH_MIN_PRICE || clampedPrice > this.PYTH_MAX_PRICE) {
        console.warn(`Pyth price out of bounds (${clampedPrice}), clamping to [${this.PYTH_MIN_PRICE}, ${this.PYTH_MAX_PRICE}]`);
        clampedPrice = Math.max(this.PYTH_MIN_PRICE, Math.min(this.PYTH_MAX_PRICE, clampedPrice));
      }

      return {
        price: clampedPrice,
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

  private async getBinancePrice(): Promise<PriceData | null> {
    try {
      // Prefer bookTicker (bid/ask) and use mid-price for a stable USD reference
      const book = await axios.get('https://api.binance.com/api/v3/ticker/bookTicker?symbol=SOLUSDT', { timeout: 3000 });
      const bid = parseFloat(book.data?.bidPrice);
      const ask = parseFloat(book.data?.askPrice);
      if (isFinite(bid) && isFinite(ask) && bid > 0 && ask > 0) {
        const mid = (bid + ask) / 2;
        return { price: mid, timestamp: Date.now(), confidence: 0, source: 'binance' };
      }

      // Fallback to last trade price if bookTicker not useful
      const resp = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { timeout: 4000 });
      const p = parseFloat(resp.data?.price);
      if (!isFinite(p) || p <= 0) throw new Error('Invalid Binance price');
      return { price: p, timestamp: Date.now(), confidence: 0, source: 'binance' };
    } catch (err) {
      // Bubble error to caller so higher-level logic can decide to use cache
      throw new Error(`Binance price fetch failed: ${String(err)}`);
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
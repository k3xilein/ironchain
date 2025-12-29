import { loadConfig } from '../config';
import { MarketData } from '../data/market-data';

(async () => {
  try {
    const config = loadConfig();
    const md = new MarketData(config);
    console.log('Initializing market data (preload) ...');
    await md.initialize();
    const c15 = md.getCandles('15m').length;
    const c4h = md.getCandles('4h').length;
    console.log(`Preload complete. 15m candles: ${c15}, 4h candles: ${c4h}`);
    process.exit(0);
  } catch (err) {
    console.error('Preload check failed:', err);
    process.exit(2);
  }
})();

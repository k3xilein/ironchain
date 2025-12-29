import { Config } from '../config';
import { PriceFeed } from '../data/price-feed';

async function main() {
  const config = (await import('../config')).default as Config;
  const pf = new PriceFeed(config);

  console.log('Checking forced live prices from providers (5 iterations, 1s interval)');

  for (let i = 0; i < 5; i++) {
    try {
      const p = await pf.getPrice(true);
      console.log(new Date().toISOString(), 'FORCED', p.source, p.price, `ts:${p.timestamp}`);
    } catch (err) {
      console.error(new Date().toISOString(), 'FORCED fetch failed:', String(err));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('Done');
}

main().catch((e) => { console.error(e); process.exit(1); });

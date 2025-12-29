import { loadConfig } from '../config';
import { CandleBuilder, Candle } from '../data/candle-builder';
import { RegimeFilter } from '../strategy/regime-filter';
import { EntrySignals } from '../strategy/entry-signals';
import { PositionSizer } from '../risk/position-sizer';
import { PaperExecutor } from '../execution/paper-executor';
import { PriceFeed } from '../data/price-feed';

async function run() {
  const config = loadConfig();

  console.log('Starting force-breakout-test (one-shot)');

  // Create synthetic 4h candles (enough for EMA200 + margin)
  const fourHourCount = Math.max(260, config.regime.emaSlow + 60);
  const candles4h: Candle[] = [];
  const startTs = Date.now() - fourHourCount * 4 * 60 * 60 * 1000;
  // Generate a gentle uptrend so EMA50 > EMA200
  for (let i = 0; i < fourHourCount; i++) {
    const t = startTs + i * 4 * 60 * 60 * 1000;
    const base = 100 + (i / fourHourCount) * 60; // 100 -> 160
    const o = base + (Math.random() - 0.5) * 0.5;
    const c = base + (Math.random() - 0.5) * 0.5 + 0.5; // slight upward bias
    const h = Math.max(o, c) + Math.random() * 0.5;
    const l = Math.min(o, c) - Math.random() * 0.5;
    candles4h.push({ timestamp: t, open: o, high: h, low: l, close: c, volume: 0 });
  }

  // Create synthetic 15m candles for entry (enough for donchianPeriod + 50)
  const fifteenCount = Math.max(120, config.entry.donchianPeriod + 80);
  const candles15m: Candle[] = [];
  const start15 = Date.now() - fifteenCount * 15 * 60 * 1000;
  // Make last candles break out above recent highs
  for (let i = 0; i < fifteenCount; i++) {
    const t = start15 + i * 15 * 60 * 1000;
    // Keep 15m around the upper range of 4h trend
    const base = 140 + (i / fifteenCount) * 5; // 140 -> 145
    const o = base + (Math.random() - 0.5) * 0.3;
    const c = base + (Math.random() - 0.5) * 0.3 + (i > fifteenCount - 3 ? 1.5 : 0); // last 2 candles push higher
    const h = Math.max(o, c) + Math.random() * 0.3;
    const l = Math.min(o, c) - Math.random() * 0.3;
    candles15m.push({ timestamp: t, open: o, high: h, low: l, close: c, volume: 0 });
  }

  // Run regime analysis
  const regimeFilter = new RegimeFilter(config.regime);
  const regimeAnalysis = regimeFilter.analyze(candles4h);
  console.log('Regime Analysis:', regimeAnalysis.regime, regimeAnalysis.reasons.slice(0,3));

  // Prepare entry signal check
  const entrySignals = new EntrySignals(config.entry, config.liquidity);
  const positionSizer = new PositionSizer(config.risk);

  const currentPrice = candles15m[candles15m.length - 1].close;
  const equity = config.trading.initialCapitalUSDC;
  const stopPrice = currentPrice * 0.97; // 3% stop for test

  const prelim = positionSizer.calculate({ equity, entryPrice: currentPrice, stopPrice, riskPercent: config.risk.riskPerTrade, maxPositionPercent: config.risk.maxPositionSize });

  const liquidity = await entrySignals.checkLiquidity(currentPrice, prelim.sizeUSDC);
  const entry = entrySignals.checkEntry(candles15m, liquidity as any);

  console.log('Entry signal:', { shouldEnter: entry.shouldEnter, reasons: entry.reasons.slice(0,3), confidence: entry.confidence, entryPrice: entry.entryPrice });

  if (!entry.shouldEnter) {
    console.log('Test did not produce an entry signal — aborting.');
    process.exit(0);
  }

  // Execute a paper buy using calculated size
  const priceFeed = new PriceFeed(config);
  const executor = new PaperExecutor(config, priceFeed);
  await executor.initialize();

  const sizeToUse = Math.max(10, prelim.sizeUSDC); // ensure min size
  console.log(`Attempting PAPER buy of $${sizeToUse.toFixed(2)} USDC at simulated price ${currentPrice.toFixed(2)}`);
  const result = await executor.buy(sizeToUse, config.risk.maxSlippage);
  console.log('Paper buy result:', result);

  console.log('Final balance:', await executor.getBalance());
  process.exit(0);
}

run().catch(err => { console.error('force-breakout-test error', err); process.exit(1); });

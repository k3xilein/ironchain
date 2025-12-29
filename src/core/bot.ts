import { Config } from '../config';
import { MarketData } from '../data/market-data';
import { RegimeFilter } from '../strategy/regime-filter';
import { EntrySignals, LiquidityData } from '../strategy/entry-signals';
import { ExitManager, Position } from '../strategy/exit-manager';
import { PositionSizer } from '../risk/position-sizer';
import { RiskManager } from '../risk/risk-manager';
import { KillSwitch } from '../risk/kill-switch';
import { Executor } from '../execution/executor';
import { Logger } from '../logging/logger';
import { AuditLogger } from '../logging/audit-logger';
import { TradingDatabase } from '../logging/database';
import { sleep } from '../utils/helpers';

export class IronChainBot {
  private config: Config;
  private marketData: MarketData;
  private regimeFilter: RegimeFilter;
  private entrySignals: EntrySignals;
  private exitManager: ExitManager;
  private positionSizer: PositionSizer;
  private riskManager: RiskManager;
  private killSwitch: KillSwitch;
  private executor: Executor;
  private logger: Logger;
  private auditLogger: AuditLogger;
  private database: TradingDatabase;
  
  private isRunning: boolean = false;
  private currentPosition: Position | null = null;
  private heartbeatHandle: any = null;

  constructor(components: {
    config: Config;
    marketData: MarketData;
    regimeFilter: RegimeFilter;
    entrySignals: EntrySignals;
    exitManager: ExitManager;
    positionSizer: PositionSizer;
    riskManager: RiskManager;
    killSwitch: KillSwitch;
    executor: Executor;
    logger: Logger;
    auditLogger: AuditLogger;
    database: TradingDatabase;
  }) {
    this.config = components.config;
    this.marketData = components.marketData;
    this.regimeFilter = components.regimeFilter;
    this.entrySignals = components.entrySignals;
    this.exitManager = components.exitManager;
    this.positionSizer = components.positionSizer;
    this.riskManager = components.riskManager;
    this.killSwitch = components.killSwitch;
    this.executor = components.executor;
    this.logger = components.logger;
    this.auditLogger = components.auditLogger;
    this.database = components.database;
  }

  async start(): Promise<void> {
    this.logger.info('Bot', '🚀 Starting Iron Chain Bot', {
      mode: this.config.runMode,
      pair: this.config.trading.pair,
    });

    this.isRunning = true;

    // Start heartbeat logger to emit a liveliness message at configured interval
    try {
      const hbInterval = (this.config.timing && (this.config.timing as any).heartbeatIntervalMs) || 150000;
      this.heartbeatHandle = (globalThis as any).setInterval(async () => {
        try {
          const now = new Date();
          const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // Compute lightweight market score (1-10) and 1-2 short reasons
          let marketScore = 5;
          const reasons: string[] = [];

          try {
            const balance = await this.executor.getBalance();
            // Force a fresh live price for heartbeat display so the operator
            // always sees the current market price (bypass PriceFeed cache).
            const price = (await this.marketData.getCurrentPrice(true)).price;
            const equity = balance.usdc + (balance.sol * price);

            // Regime analysis (4h) if enough data
            try {
              if (this.marketData.hasEnoughData('4h', this.config.regime.emaSlow + 50)) {
                const regimeAnalysis = this.regimeFilter.analyze(this.marketData.getCandles('4h'));
                if (regimeAnalysis.regime === 'BULL') {
                  marketScore += Math.round(regimeAnalysis.confidence * 3);
                  reasons.push(`Bull trend (${(regimeAnalysis.confidence * 100).toFixed(0)}% conf)`);
                } else if (regimeAnalysis.regime === 'BEAR') {
                  marketScore -= Math.round(regimeAnalysis.confidence * 3);
                  reasons.push(`Bear trend (${(regimeAnalysis.confidence * 100).toFixed(0)}% conf)`);
                } else {
                  reasons.push('Sideways / mixed signals');
                }
              } else {
                reasons.push('Insufficient 4h data');
              }
            } catch (err) {
              reasons.push('Regime analysis failed');
            }

            // Entry signal (15m) quick check to see if there's a near-term opportunity
            try {
              if (this.marketData.hasEnoughData('15m', this.config.entry.donchianPeriod + 50)) {
                const candles15 = this.marketData.getCandles('15m');
                // approximate size as used in entry path
                const preliminary = this.positionSizer.calculate({
                  equity,
                  entryPrice: price,
                  stopPrice: price * 0.97,
                  riskPercent: this.config.risk.riskPerTrade,
                  maxPositionPercent: this.config.risk.maxPositionSize,
                });
                const liquidity = await this.entrySignals.checkLiquidity(price, preliminary.sizeUSDC);
                const entry = this.entrySignals.checkEntry(candles15, liquidity);
                if (entry.shouldEnter) {
                  marketScore += Math.round(entry.confidence * 2);
                  reasons.push(`Entry candidate: ${(entry.confidence * 100).toFixed(0)}%`);
                } else {
                  // add one reason for visibility
                  if (entry.reasons && entry.reasons.length > 0) {
                    reasons.push(entry.reasons[0]);
                  }
                }
              } else {
                reasons.push('Insufficient 15m data');
              }
            } catch (err) {
              reasons.push('Entry check failed');
            }

            // Bound score to 1..10
            marketScore = Math.max(1, Math.min(10, marketScore));

            // Compose status
            let status = '';
            if (this.currentPosition) {
              status = `Pos aktiv — Entry ${this.currentPosition.entryPrice.toFixed(2)}, Amt ${this.currentPosition.amount.toFixed(4)}, Equity ${equity.toFixed(2)} USD`;
            } else {
              const riskStatus = this.riskManager.canTrade();
              if (!riskStatus.canTrade) {
                status = `Trading paused (${riskStatus.reason})`;
              } else {
                status = `Market-Score ${marketScore}/10 — ${reasons.slice(0,2).join('; ')} — Equity ${equity.toFixed(2)} USD`;
              }
            }

            this.logger.info('Bot', `${time} — Heartbeat: ${status}`);
          } catch (err) {
            this.logger.info('Bot', `${time} — Heartbeat: Status unknown (error computing market score)`);
          }
        } catch (err) {
          // swallow
        }
      }, hbInterval);
    } catch (err) {
      this.logger.debug('Bot', 'Failed to start heartbeat', { error: String(err) });
    }

    while (this.isRunning) {
      try {
        await this.runCycle();
        await sleep(this.config.timing.checkInterval);
      } catch (error) {
        this.logger.error('Bot', 'Cycle error', { error });
        await this.handleError(error);
      }
    }
  }

  private async runCycle(): Promise<void> {
  // Live log cycle start
  this.logger.info('Bot', 'Starting cycle', { pair: this.config.trading.pair, timestamp: Date.now() });
    // Check kill switch
    if (this.killSwitch.isTriggered()) {
      this.logger.warn('Bot', '🚨 Kill switch is active, stopping');
      await this.shutdown();
      return;
    }

    // Update market data
    await this.marketData.update();

    // Update equity
    await this.updateEquity();

    // Check risk limits
    const riskStatus = this.riskManager.canTrade();
    if (!riskStatus.canTrade) {
      this.logger.warn('Bot', 'Trading halted by risk manager', {
        reason: riskStatus.reason,
        drawdown: riskStatus.currentDrawdown,
      });
      
      if (this.riskManager.isKillSwitchTriggered()) {
        this.killSwitch.trigger('drawdown', riskStatus);
        await this.closeAllPositions();
      }
      return;
    }

    // Check regime
    const candles4h = this.marketData.getCandles('4h');
    if (!this.marketData.hasEnoughData('4h', this.config.regime.emaSlow + 50)) {
      this.logger.debug('Bot', 'Insufficient 4h data for regime filter');
      return;
    }

    const regimeAnalysis = this.regimeFilter.analyze(candles4h);
    this.auditLogger.logRegimeCheck(
      regimeAnalysis.regime,
      regimeAnalysis.indicators,
      regimeAnalysis.reasons
    );

    if (!this.regimeFilter.canTrade(regimeAnalysis.regime)) {
      this.logger.info('Bot', `Regime is ${regimeAnalysis.regime}, skipping`, {
        reasons: regimeAnalysis.reasons,
      });
      return;
    }

    // Check for entry if no position
    if (!this.currentPosition) {
      await this.checkEntry();
    }

    // Check for exit if position exists
    if (this.currentPosition) {
      await this.checkExit();
    }
  }

  private async checkEntry(): Promise<void> {
    this.logger.info('Bot', 'Analyzing for possible entries', { pair: this.config.trading.pair, timeframe: '15m' });
    const candles15m = this.marketData.getCandles('15m');
    
    if (!this.marketData.hasEnoughData('15m', this.config.entry.donchianPeriod + 50)) {
      this.logger.debug('Bot', 'Insufficient 15m data for entry signals');
      return;
    }

    // Get current price
    const currentPrice = (await this.marketData.getCurrentPrice()).price;

    // Estimate position size for liquidity check
    const balance = await this.executor.getBalance();
    const equity = balance.usdc + (balance.sol * currentPrice);
    
    const preliminarySize = this.positionSizer.calculate({
      equity,
      entryPrice: currentPrice,
      stopPrice: currentPrice * 0.97, // Rough estimate
      riskPercent: this.config.risk.riskPerTrade,
      maxPositionPercent: this.config.risk.maxPositionSize,
    });

    // Check liquidity
    const liquidity = await this.entrySignals.checkLiquidity(
      currentPrice,
      preliminarySize.sizeUSDC
    );

  this.logger.info('Bot', 'Liquidity check result', { liquidity });

    // Check entry signal
    const entrySignal = this.entrySignals.checkEntry(candles15m, liquidity);

  this.logger.info('Bot', 'Entry signal computed', { shouldEnter: entrySignal.shouldEnter, indicators: entrySignal.indicators, reasons: entrySignal.reasons, entryPrice: entrySignal.entryPrice });

    this.auditLogger.logEntryEvaluation(
      entrySignal.shouldEnter ? 'trade' : 'no_trade',
      entrySignal.indicators,
      entrySignal.reasons
    );

    if (!entrySignal.shouldEnter) {
      this.logger.debug('Bot', 'No entry signal', {
        reasons: entrySignal.reasons,
      });
      return;
    }

    // Calculate exact position size
    const stopPrice = this.exitManager.calculateInitialStop(candles15m, entrySignal.entryPrice);
    
    const positionSize = this.positionSizer.calculate({
      equity,
      entryPrice: entrySignal.entryPrice,
      stopPrice,
      riskPercent: this.config.risk.riskPerTrade,
      maxPositionPercent: this.config.risk.maxPositionSize,
    });

    // Validate position size
    const sizeValidation = this.positionSizer.validateSize(positionSize, equity);
    if (!sizeValidation.valid) {
      this.logger.warn('Bot', 'Position size invalid', {
        reason: sizeValidation.reason,
      });
      return;
    }

    // Execute entry
    await this.executeEntry(entrySignal.entryPrice, stopPrice, positionSize.sizeUSDC);
  }

  private async executeEntry(entryPrice: number, stopPrice: number, sizeUSDC: number): Promise<void> {
    this.logger.info('Bot', '📈 Executing entry', {
      entryPrice,
      stopPrice,
      sizeUSDC,
    });

    try {
      const result = await this.executor.buy(sizeUSDC, this.config.risk.maxSlippage);

      if (!result.success) {
        this.logger.error('Bot', 'Entry execution failed', { error: result.error });
        return;
      }

      // Create position
      this.currentPosition = {
        entryPrice: result.price,
        amount: result.amount,
        stopPrice,
        entryTime: Date.now(),
        partialTaken: false,
        trailingStopActive: false,
      };

      this.riskManager.addPosition(this.currentPosition);

      // Log to database
      const positionId = this.database.insertPosition({
        entryTime: this.currentPosition.entryTime,
        entryPrice: this.currentPosition.entryPrice,
        amount: this.currentPosition.amount,
        stopPrice: this.currentPosition.stopPrice,
        regime: 'BULL',
      });

      // Attach DB id to in-memory position for future updates
      try {
        (this.currentPosition as any).id = positionId;
      } catch (err) {
        this.logger.debug('Bot', 'Failed to attach position id to currentPosition', { error: String(err) });
      }

      this.database.insertTrade({
        timestamp: Date.now(),
        direction: 'buy',
        price: result.price,
        amount: result.amount,
        valueUSDC: sizeUSDC,
        feeUSDC: result.fee,
        slippage: result.slippage,
        txHash: result.txHash,
        positionId,
      });

      this.auditLogger.logTradeExecuted('buy', result.price, result.amount, {
        fee: result.fee,
        slippage: result.slippage,
      });

      this.logger.info('Bot', '✅ Entry executed successfully', {
        price: result.price,
        amount: result.amount,
        txHash: result.txHash,
      });

      // Log updated balance after entry
      try {
        const newBalance = await this.executor.getBalance();
        this.logger.info('Bot', 'Balance updated (post-entry)', newBalance);
      } catch (err) {
        this.logger.debug('Bot', 'Failed to fetch balance after entry', { error: String(err) });
      }

    } catch (error) {
      this.logger.error('Bot', 'Entry execution error', { error });
    }
  }

  private async checkExit(): Promise<void> {
    if (!this.currentPosition) return;

    const candles15m = this.marketData.getCandles('15m');
    const currentPrice = (await this.marketData.getCurrentPrice()).price;

    const exitSignal = this.exitManager.checkExit(
      this.currentPosition,
      candles15m,
      currentPrice
    );

    this.auditLogger.logExitEvaluation(
      exitSignal.shouldExit ? 'exit' : 'no_trade',
      exitSignal.exitType,
      { currentPrice, rMultiple: exitSignal.rMultiple },
      exitSignal.reasons
    );

    if (!exitSignal.shouldExit) {
      return;
    }

    // Execute exit
    await this.executeExit(exitSignal.exitType, exitSignal.percentage, currentPrice);

    // Update position if partial exit
    if (exitSignal.percentage < 1.0) {
      this.currentPosition = this.exitManager.updatePosition(
        this.currentPosition,
        exitSignal
      );
    } else {
      this.currentPosition = null;
    }
  }

  private async executeExit(
    exitType: string,
    percentage: number,
    exitPrice: number
  ): Promise<void> {
    if (!this.currentPosition) return;

    const amountToSell = this.currentPosition.amount * percentage;

    this.logger.info('Bot', '📉 Executing exit', {
      exitType,
      percentage,
      amount: amountToSell,
      exitPrice,
    });

    try {
      const result = await this.executor.sell(amountToSell, this.config.risk.maxSlippage);

      if (!result.success) {
        this.logger.error('Bot', 'Exit execution failed', { error: result.error });
        return;
      }

      // Calculate P&L
      const entryValue = amountToSell * this.currentPosition.entryPrice;
      const exitValue = result.amount; // USDC received
      const pnl = exitValue - entryValue;
  const risk = amountToSell * (this.currentPosition.entryPrice - this.currentPosition.stopPrice);
      const rMultiple = pnl / risk;
      const holdTime = (Date.now() - this.currentPosition.entryTime) / 1000;

      // Update database
      if (percentage >= 1.0) {
        // Position fully closed — update DB using stored position id if available
        const posId = (this.currentPosition as any)?.id;
        if (posId && posId > 0) {
          this.database.updatePosition(posId, {
            exitTime: Date.now(),
            exitPrice: result.price,
            pnlUSDC: pnl,
            pnlPercent: (pnl / entryValue) * 100,
            rMultiple,
            holdDurationSeconds: holdTime,
            exitReason: exitType,
            outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
          });

          this.auditLogger.logPositionClosed(pnl, rMultiple, holdTime, exitType);
        } else {
          this.logger.warn('Bot', 'Closing position but no DB position id found; skipping DB update', { exitType, rMultiple, pnl });
        }
      }

      this.database.insertTrade({
        timestamp: Date.now(),
        direction: 'sell',
        price: result.price,
        amount: amountToSell,
        valueUSDC: result.amount,
        feeUSDC: result.fee,
        slippage: result.slippage,
        txHash: result.txHash,
      });

      this.logger.info('Bot', '✅ Exit executed successfully', {
        price: result.price,
        pnl,
        rMultiple,
        txHash: result.txHash,
      });

      // Log updated balance after exit
      try {
        const newBalance = await this.executor.getBalance();
        this.logger.info('Bot', 'Balance updated (post-exit)', newBalance);
      } catch (err) {
        this.logger.debug('Bot', 'Failed to fetch balance after exit', { error: String(err) });
      }

    } catch (error) {
      this.logger.error('Bot', 'Exit execution error', { error });
    }
  }

  private async updateEquity(): Promise<void> {
    const currentPrice = (await this.marketData.getCurrentPrice()).price;
    const balance = await this.executor.getBalance();
    const totalEquity = balance.usdc + (balance.sol * currentPrice);

    this.riskManager.updateEquity(totalEquity);

    const riskStatus = this.riskManager.canTrade();

    this.database.insertEquity({
      timestamp: Date.now(),
      totalEquity,
      solBalance: balance.sol,
      usdcBalance: balance.usdc,
      drawdownPercent: riskStatus.currentDrawdown,
      highWaterMark: riskStatus.highWaterMark,
    });
  }

  private async closeAllPositions(): Promise<void> {
    if (this.currentPosition) {
      const currentPrice = (await this.marketData.getCurrentPrice()).price;
      await this.executeExit('kill_switch', 1.0, currentPrice);
      this.currentPosition = null;
    }
  }

  private async handleError(error: any): Promise<void> {
    this.logger.error('Bot', 'Critical error', { error });
    
    // For critical errors, trigger kill switch
    if (error.message && error.message.includes('RPC')) {
      this.killSwitch.trigger('rpc_failure', { error: error.message });
    } else {
      this.killSwitch.trigger('system_error', { error: String(error) });
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Bot', '🛑 Shutting down Iron Chain Bot');
    
    this.isRunning = false;
    // Stop heartbeat
    try {
        if (this.heartbeatHandle) {
        (globalThis as any).clearInterval(this.heartbeatHandle);
        this.heartbeatHandle = null;
      }
    } catch (err) {
      this.logger.debug('Bot', 'Failed to clear heartbeat', { error: String(err) });
    }
    
    // Close any open positions
    await this.closeAllPositions();
    
    // Close database
    this.database.close();
    
    this.logger.info('Bot', '✅ Shutdown complete');
  }

  stop(): void {
    this.isRunning = false;
  }

  getTotalEquity(currentPrice: number): number {
    if (this.currentPosition) {
      return this.currentPosition.amount * currentPrice;
    }
    return 0;
  }

  // Exposed helper methods for external control / UI integration
  /**
   * Returns a lightweight status object useful for Web UI or health checks.
   */
  async getStatus(): Promise<{ isRunning: boolean; hasPosition: boolean; currentPosition?: Position | null }> {
    return {
      isRunning: this.isRunning,
      hasPosition: !!this.currentPosition,
      currentPosition: this.currentPosition,
    };
  }

  /**
   * Returns the current executor balance (sol/usdc)
   */
  async getBalance(): Promise<{ sol: number; usdc: number }> {
    try {
      const b = await this.executor.getBalance();
      return { sol: b.sol, usdc: b.usdc };
    } catch (err) {
      this.logger.debug('Bot', 'getBalance failed', { error: String(err) });
      return { sol: 0, usdc: 0 };
    }
  }

  /**
   * Returns currently tracked open positions (in-memory snapshot)
   */
  getActiveTrades(): Position[] {
    return this.riskManager.getOpenPositions();
  }
}
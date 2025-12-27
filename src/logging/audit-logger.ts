import * as fs from 'fs';
import * as path from 'path';
import { Config, Regime } from '../config';

export interface AuditEntry {
  timestamp: string;
  type: string;
  regime?: Regime;
  indicators?: Record<string, any>;
  decision: 'trade' | 'no_trade' | 'exit' | 'other';
  reasons: string[];
  outcome?: {
    pnl?: number;
    rMultiple?: number;
    holdTime?: number;
  };
  [key: string]: any;
}

export class AuditLogger {
  private config: Config;
  private auditLogPath: string = '';

  constructor(config: Config) {
    this.config = config;

    if (!config.logging.enableAuditLog) {
      return;
    }

    // Ensure log directory exists
    if (!fs.existsSync(config.logging.directory)) {
      fs.mkdirSync(config.logging.directory, { recursive: true });
    }

    this.auditLogPath = path.join(config.logging.directory, 'audit.jsonl');
  }

  log(entry: Partial<AuditEntry>): void {
    if (!this.config.logging.enableAuditLog) {
      return;
    }

    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      type: entry.type || 'unknown',
      decision: entry.decision || 'other',
      reasons: entry.reasons || [],
      ...entry,
    };

    const formatted = JSON.stringify(fullEntry) + '\n';

    try {
      fs.appendFileSync(this.auditLogPath, formatted);
    } catch (error) {
      console.error('Failed to write to audit log:', error);
    }
  }

  logRegimeCheck(regime: Regime, indicators: any, reasons: string[]): void {
    this.log({
      type: 'regime_check',
      regime,
      indicators,
      decision: 'other',
      reasons,
    });
  }

  logEntryEvaluation(
    decision: 'trade' | 'no_trade',
    indicators: any,
    reasons: string[]
  ): void {
    this.log({
      type: 'entry_evaluation',
      decision,
      indicators,
      reasons,
    });
  }

  logTradeExecuted(
    direction: 'buy' | 'sell',
    price: number,
    amount: number,
    indicators: any
  ): void {
    this.log({
      type: 'trade_executed',
      decision: 'trade',
      direction,
      price,
      amount,
      indicators,
      reasons: ['Trade executed'],
    });
  }

  logExitEvaluation(
    decision: 'exit' | 'no_trade',
    exitType: string,
    indicators: any,
    reasons: string[]
  ): void {
    this.log({
      type: 'exit_evaluation',
      decision,
      exitType,
      indicators,
      reasons,
    });
  }

  logPositionClosed(
    pnl: number,
    rMultiple: number,
    holdTime: number,
    exitReason: string
  ): void {
    this.log({
      type: 'position_closed',
      decision: 'exit',
      outcome: {
        pnl,
        rMultiple,
        holdTime,
      },
      reasons: [exitReason],
    });
  }

  logKillSwitch(trigger: string, data: any): void {
    this.log({
      type: 'kill_switch_triggered',
      decision: 'other',
      trigger,
      data,
      reasons: ['Emergency shutdown'],
    });
  }
}
import Database from 'better-sqlite3';
import { Config } from '../config';
import * as path from 'path';
import * as fs from 'fs';

export interface TradeRecord {
  id?: number;
  timestamp: number;
  direction: 'buy' | 'sell';
  price: number;
  amount: number;
  valueUSDC: number;
  feeUSDC: number;
  slippage: number;
  txHash: string;
  positionId?: number;
}

export interface PositionRecord {
  id?: number;
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  stopPrice: number;
  pnlUSDC?: number;
  pnlPercent?: number;
  rMultiple?: number;
  holdDurationSeconds?: number;
  exitReason?: string;
  outcome?: 'win' | 'loss' | 'breakeven';
  regime?: string;
  entryIndicators?: string;
  exitIndicators?: string;
}

export interface EquityRecord {
  timestamp: number;
  totalEquity: number;
  solBalance: number;
  usdcBalance: number;
  unrealizedPnl?: number;
  drawdownPercent?: number;
  highWaterMark?: number;
}

export interface DecisionRecord {
  timestamp: number;
  decisionType: string;
  action: 'trade' | 'no_trade' | 'exit';
  regime?: string;
  reasons: string;
  indicators?: string;
  outcome?: string;
}

export class TradingDatabase {
  private db!: Database.Database;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    if (!config.database.enabled) {
      return;
    }

    // Ensure data directory exists
    const dbDir = path.dirname(config.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(config.database.path);
    
    // Initialize schema
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        direction TEXT NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        value_usdc REAL NOT NULL,
        fee_usdc REAL NOT NULL,
        slippage REAL NOT NULL,
        tx_hash TEXT,
        position_id INTEGER,
        FOREIGN KEY (position_id) REFERENCES positions(id)
      );

      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_time INTEGER NOT NULL,
        exit_time INTEGER,
        entry_price REAL NOT NULL,
        exit_price REAL,
        amount REAL NOT NULL,
        stop_price REAL NOT NULL,
        pnl_usdc REAL,
        pnl_percent REAL,
        r_multiple REAL,
        hold_duration_seconds INTEGER,
        exit_reason TEXT,
        outcome TEXT,
        regime TEXT,
        entry_indicators TEXT,
        exit_indicators TEXT
      );

      CREATE TABLE IF NOT EXISTS equity_curve (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_equity REAL NOT NULL,
        sol_balance REAL NOT NULL,
        usdc_balance REAL NOT NULL,
        unrealized_pnl REAL,
        drawdown_percent REAL,
        high_water_mark REAL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        decision_type TEXT NOT NULL,
        action TEXT NOT NULL,
        regime TEXT,
        reasons TEXT,
        indicators TEXT,
        outcome TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT,
        description TEXT,
        data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_positions_entry_time ON positions(entry_time);
      CREATE INDEX IF NOT EXISTS idx_positions_outcome ON positions(outcome);
      CREATE INDEX IF NOT EXISTS idx_equity_timestamp ON equity_curve(timestamp);
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);
    `);
  }

  insertTrade(trade: TradeRecord): number {
    if (!this.config.database.enabled) return 0;

    const stmt = this.db.prepare(`
      INSERT INTO trades (timestamp, direction, price, amount, value_usdc, fee_usdc, slippage, tx_hash, position_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      trade.timestamp,
      trade.direction,
      trade.price,
      trade.amount,
      trade.valueUSDC,
      trade.feeUSDC,
      trade.slippage,
      trade.txHash,
      trade.positionId || null
    );

    return info.lastInsertRowid as number;
  }

  insertPosition(position: PositionRecord): number {
    if (!this.config.database.enabled) return 0;

    const stmt = this.db.prepare(`
      INSERT INTO positions (
        entry_time, exit_time, entry_price, exit_price, amount, stop_price,
        pnl_usdc, pnl_percent, r_multiple, hold_duration_seconds,
        exit_reason, outcome, regime, entry_indicators, exit_indicators
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      position.entryTime,
      position.exitTime || null,
      position.entryPrice,
      position.exitPrice || null,
      position.amount,
      position.stopPrice,
      position.pnlUSDC || null,
      position.pnlPercent || null,
      position.rMultiple || null,
      position.holdDurationSeconds || null,
      position.exitReason || null,
      position.outcome || null,
      position.regime || null,
      position.entryIndicators || null,
      position.exitIndicators || null
    );

    return info.lastInsertRowid as number;
  }

  updatePosition(id: number, updates: Partial<PositionRecord>): void {
    if (!this.config.database.enabled) return;

    const fields = Object.keys(updates)
      .map(key => `${this.camelToSnake(key)} = ?`)
      .join(', ');

    const values = Object.values(updates);
    values.push(id);

    const stmt = this.db.prepare(`UPDATE positions SET ${fields} WHERE id = ?`);
    stmt.run(...values);
  }

  insertEquity(equity: EquityRecord): void {
    if (!this.config.database.enabled) return;

    const stmt = this.db.prepare(`
      INSERT INTO equity_curve (
        timestamp, total_equity, sol_balance, usdc_balance,
        unrealized_pnl, drawdown_percent, high_water_mark
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      equity.timestamp,
      equity.totalEquity,
      equity.solBalance,
      equity.usdcBalance,
      equity.unrealizedPnl || null,
      equity.drawdownPercent || null,
      equity.highWaterMark || null
    );
  }

  insertDecision(decision: DecisionRecord): void {
    if (!this.config.database.enabled) return;

    const stmt = this.db.prepare(`
      INSERT INTO decisions (timestamp, decision_type, action, regime, reasons, indicators, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.timestamp,
      decision.decisionType,
      decision.action,
      decision.regime || null,
      decision.reasons,
      decision.indicators || null,
      decision.outcome || null
    );
  }

  getPositions(limit?: number): PositionRecord[] {
    if (!this.config.database.enabled) return [];

    const sql = limit
      ? `SELECT * FROM positions ORDER BY entry_time DESC LIMIT ?`
      : `SELECT * FROM positions ORDER BY entry_time DESC`;

    const stmt = this.db.prepare(sql);
    return (limit ? stmt.all(limit) : stmt.all()) as PositionRecord[];
  }

  getClosedPositions(): PositionRecord[] {
    if (!this.config.database.enabled) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM positions WHERE exit_time IS NOT NULL ORDER BY entry_time DESC
    `);

    return stmt.all() as PositionRecord[];
  }

  getEquityCurve(limit?: number): EquityRecord[] {
    if (!this.config.database.enabled) return [];

    const sql = limit
      ? `SELECT * FROM equity_curve ORDER BY timestamp DESC LIMIT ?`
      : `SELECT * FROM equity_curve ORDER BY timestamp DESC`;

    const stmt = this.db.prepare(sql);
    return (limit ? stmt.all(limit) : stmt.all()) as EquityRecord[];
  }

  vacuum(): void {
    if (!this.config.database.enabled) return;
    this.db.exec('VACUUM');
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
import { RiskConfig } from '../config';
import { Position } from '../strategy/exit-manager';

export interface RiskStatus {
  canTrade: boolean;
  reason?: string;
  currentDrawdown: number;
  highWaterMark: number;
  currentEquity: number;
}

export class RiskManager {
  private config: RiskConfig;
  private highWaterMark: number;
  private currentEquity: number;
  private openPositions: Position[] = [];
  private killSwitchTriggered: boolean = false;
  private startedAt: number = Date.now();
  private startupGraceMs: number = 60 * 1000; // 60 seconds grace period on startup

  constructor(config: RiskConfig, initialEquity: number) {
    this.config = config;
    this.currentEquity = initialEquity;
    this.highWaterMark = initialEquity;
  }

  updateEquity(newEquity: number): void {
    this.currentEquity = newEquity;
    
    // Update high water mark
    if (newEquity > this.highWaterMark) {
      this.highWaterMark = newEquity;
    }
  }

  checkDrawdown(): {
    currentDD: number;
    killSwitchTriggered: boolean;
  } {
    const drawdown = (this.highWaterMark - this.currentEquity) / this.highWaterMark;

    if (this.config.enableKillSwitch && drawdown >= this.config.maxDrawdownPercent) {
      this.killSwitchTriggered = true;
    }

    return {
      currentDD: drawdown,
      killSwitchTriggered: this.killSwitchTriggered,
    };
  }

  canTrade(): RiskStatus {
    const drawdownCheck = this.checkDrawdown();

    // During a short startup grace period, avoid triggering the kill switch
    // immediately due to HWM mismatches when the process is just starting
    // up and balances/prices are still being derived.
    if (Date.now() - this.startedAt < this.startupGraceMs) {
      return {
        canTrade: true,
        currentDrawdown: drawdownCheck.currentDD,
        highWaterMark: this.highWaterMark,
        currentEquity: this.currentEquity,
      };
    }

    // Check kill switch
    if (this.killSwitchTriggered) {
      return {
        canTrade: false,
        reason: `Kill switch triggered (${(drawdownCheck.currentDD * 100).toFixed(1)}% drawdown)`,
        currentDrawdown: drawdownCheck.currentDD,
        highWaterMark: this.highWaterMark,
        currentEquity: this.currentEquity,
      };
    }

    // Check if approaching drawdown limit (warn at 80%)
    if (drawdownCheck.currentDD >= this.config.maxDrawdownPercent * 0.8) {
      console.warn(
        `⚠️  High drawdown: ${(drawdownCheck.currentDD * 100).toFixed(1)}%`
      );
    }

    return {
      canTrade: true,
      currentDrawdown: drawdownCheck.currentDD,
      highWaterMark: this.highWaterMark,
      currentEquity: this.currentEquity,
    };
  }

  addPosition(position: Position): void {
    this.openPositions.push(position);
  }

  removePosition(position: Position): void {
    const index = this.openPositions.indexOf(position);
    if (index > -1) {
      this.openPositions.splice(index, 1);
    }
  }

  getOpenPositions(): Position[] {
    return [...this.openPositions];
  }

  getTotalExposure(): number {
    return this.openPositions.reduce((sum, pos) => {
      return sum + (pos.amount * pos.entryPrice);
    }, 0);
  }

  reset(): void {
    this.killSwitchTriggered = false;
    this.highWaterMark = this.currentEquity;
  }

  isKillSwitchTriggered(): boolean {
    return this.killSwitchTriggered;
  }
}
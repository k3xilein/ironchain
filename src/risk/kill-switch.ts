import * as fs from 'fs';
import { Config } from '../config';

export type KillSwitchTrigger = 
  | 'drawdown'
  | 'oracle_divergence'
  | 'manual'
  | 'rpc_failure'
  | 'system_error';

export interface KillSwitchEvent {
  type: KillSwitchTrigger;
  triggered: boolean;
  timestamp: number;
  data: any;
}

export class KillSwitch {
  private config: Config;
  private triggered: boolean = false;
  private triggerEvent: KillSwitchEvent | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  trigger(type: KillSwitchTrigger, data: any = {}): void {
    this.triggered = true;
    this.triggerEvent = {
      type,
      triggered: true,
      timestamp: Date.now(),
      data,
    };

    console.error('🚨 KILL SWITCH TRIGGERED:', type);
    console.error('Data:', data);

    // Write trigger file
    this.writeTriggerFile();
  }

  isTriggered(): boolean {
    // Check manual trigger file
    if (fs.existsSync(this.config.safety.killSwitchFile)) {
      if (!this.triggered) {
        this.trigger('manual', { source: 'file' });
      }
      return true;
    }

    return this.triggered;
  }

  getTriggerEvent(): KillSwitchEvent | null {
    return this.triggerEvent;
  }

  reset(): void {
    this.triggered = false;
    this.triggerEvent = null;

    // Remove trigger file if exists
    if (fs.existsSync(this.config.safety.killSwitchFile)) {
      fs.unlinkSync(this.config.safety.killSwitchFile);
    }

    console.log('✅ Kill switch reset');
  }

  private writeTriggerFile(): void {
    try {
      const content = JSON.stringify(this.triggerEvent, null, 2);
      fs.writeFileSync(this.config.safety.killSwitchFile, content);
    } catch (error) {
      console.error('Failed to write kill switch file:', error);
    }
  }
}
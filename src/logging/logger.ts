import * as fs from 'fs';
import * as path from 'path';
import { Config, LogLevel } from '../config';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
}

export class Logger {
  private config: Config;
  private logFilePath: string;
  private errorLogPath: string;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  constructor(config: Config) {
    this.config = config;
    
    // Ensure log directory exists
    if (!fs.existsSync(config.logging.directory)) {
      fs.mkdirSync(config.logging.directory, { recursive: true });
    }

    this.logFilePath = path.join(config.logging.directory, 'iron-chain.log');
    this.errorLogPath = path.join(config.logging.directory, 'errors.jsonl');
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.config.logging.level];
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry) + '\n';
  }

  private writeToFile(content: string, filePath: string): void {
    if (this.config.logging.toFile) {
      try {
        fs.appendFileSync(filePath, content);
        this.checkFileSize(filePath);
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  private checkFileSize(filePath: string): void {
    try {
      const stats = fs.statSync(filePath);
      const maxSize = this.config.logging.maxFileSize * 1024 * 1024; // MB to bytes

      if (stats.size > maxSize) {
        this.rotateLog(filePath);
      }
    } catch (error) {
      // File might not exist yet
    }
  }

  private rotateLog(filePath: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${filePath}.${timestamp}`;
    
    try {
      fs.renameSync(filePath, rotatedPath);
      
      // Compress old log (optional)
      // Could use zlib here if desired
      
    } catch (error) {
      console.error('Failed to rotate log:', error);
    }
  }

  log(level: LogLevel, component: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      data,
    };

    const formatted = this.formatEntry(entry);

    // Write to main log
    this.writeToFile(formatted, this.logFilePath);

    // Write errors to separate file
    if (level === 'error' || level === 'fatal') {
      this.writeToFile(formatted, this.errorLogPath);
    }

    // Console output
    if (this.config.logging.toConsole) {
      const color = this.getColor(level);
      console.log(
        `${color}[${entry.timestamp}] ${level.toUpperCase()} [${component}]:${'\x1b[0m'} ${message}`
      );
      if (data) {
        console.log(data);
      }
    }
  }

  private getColor(level: LogLevel): string {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      fatal: '\x1b[35m', // Magenta
    };
    return colors[level];
  }

  debug(component: string, message: string, data?: any): void {
    this.log('debug', component, message, data);
  }

  info(component: string, message: string, data?: any): void {
    this.log('info', component, message, data);
  }

  warn(component: string, message: string, data?: any): void {
    this.log('warn', component, message, data);
  }

  error(component: string, message: string, data?: any): void {
    this.log('error', component, message, data);
  }

  fatal(component: string, message: string, data?: any): void {
    this.log('fatal', component, message, data);
  }
}
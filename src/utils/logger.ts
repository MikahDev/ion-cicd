/**
 * Logger Utility
 * Provides structured logging with levels and formatting
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLOURS: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.hex('#FFA500'), // Orange
  error: chalk.bold.red,
};

const LOG_PREFIXES: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

/**
 * Logger class for structured logging
 */
export class Logger {
  private context: string;
  private static minLevel: LogLevel = 'warn';
  private static jsonOutput = false;

  /**
   * Creates a new logger instance
   * @param context - Context name for log entries (e.g., 'IONClient')
   */
  constructor(context: string) {
    this.context = context;
  }

  /**
   * Sets the minimum log level globally
   * @param level - Minimum level to display
   */
  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  /**
   * Sets JSON output mode
   * @param enabled - Whether to output JSON format
   */
  static setJsonOutput(enabled: boolean): void {
    Logger.jsonOutput = enabled;
  }

  /**
   * Gets the current minimum log level
   */
  static getLevel(): LogLevel {
    return Logger.minLevel;
  }

  /**
   * Checks if a level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[Logger.minLevel];
  }

  /**
   * Formats and outputs a log entry
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();

    if (Logger.jsonOutput) {
      const entry: LogEntry = {
        level,
        message,
        context,
        timestamp,
      };
      // Using console methods based on level for proper stream routing
      if (level === 'error') {
        console.error(JSON.stringify(entry));
      } else if (level === 'warn') {
        console.warn(JSON.stringify(entry));
      } else {
        // For info and debug in JSON mode, still use console.log
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(entry));
      }
      return;
    }

    const colour = LOG_COLOURS[level];
    const prefix = LOG_PREFIXES[level];
    const contextStr = context ? ` ${chalk.gray(JSON.stringify(context))}` : '';
    const formattedMessage = `${chalk.gray(timestamp)} ${colour(prefix)} ${chalk.cyan(`[${this.context}]`)} ${message}${contextStr}`;

    if (level === 'error') {
      console.error(formattedMessage);
    } else if (level === 'warn') {
      console.warn(formattedMessage);
    } else {
      // For debug and info, we need to bypass the eslint rule
      // eslint-disable-next-line no-console
      console.log(formattedMessage);
    }
  }

  /**
   * Logs a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Logs an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Logs an error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger('ion-cicd');

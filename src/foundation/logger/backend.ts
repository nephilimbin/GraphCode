/**
 * Logger Backend Interface
 *
 * Defines the contract for custom logger backends.
 * Extension layers can implement this to redirect logs to different sinks
 * (e.g., VS Code OutputChannel, file, network service).
 *
 * @example
 * ```typescript
 * import { type LoggerBackend, type ILogger, setLoggerBackend } from '@/foundation/logger';
 *
 * class VSCodeOutputChannelBackend implements LoggerBackend {
 *   createLogger(prefix: string, level?: LogLevel): ILogger {
 *     return new VSCodeLogger(prefix, level);
 *   }
 * }
 *
 * // In extension activation
 * setLoggerBackend(new VSCodeOutputChannelBackend());
 * ```
 */

import type { ILogger, LogLevel } from './logger';

/**
 * Logger backend interface.
 *
 * Implementations must provide a createLogger method that returns
 * an ILogger instance configured with the given prefix and level.
 */
export interface LoggerBackend {
  /**
   * Create a new logger instance with the given configuration.
   *
   * @param prefix - The logger prefix (typically module name)
   * @param level - The log level (defaults to 'info')
   * @returns A configured ILogger instance
   */
  createLogger(prefix: string, level?: LogLevel): ILogger;
}

/**
 * Configuration options for logger backends.
 */
export interface LoggerBackendOptions {
  /**
   * Whether to include timestamps in log messages.
   * @default true
   */
  includeTimestamp?: boolean;

  /**
   * Whether to include log level in messages.
   * @default true
   */
  includeLevel?: boolean;

  /**
   * Custom timestamp format function.
   * @default () => new Date().toISOString()
   */
  formatTimestamp?: () => string;
}

/**
 * Default logger backend options.
 */
export const DEFAULT_LOGGER_BACKEND_OPTIONS: LoggerBackendOptions = {
  includeTimestamp: true,
  includeLevel: true,
  formatTimestamp: () => new Date().toISOString(),
};

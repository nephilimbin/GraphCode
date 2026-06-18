/**
 * Logger Module - Barrel export
 *
 * Provides a unified logging interface with configurable log levels.
 * This module is VS Code agnostic and can be used in any Node.js context.
 *
 * @example
 * ```typescript
 * import { getLogger, setLoggerBackend } from '@/foundation/logger';
 *
 * const logger = getLogger('MyModule');
 * logger.info('Hello, world!');
 *
 * // Set custom backend (e.g., in extension)
 * setLoggerBackend(new VSCodeOutputChannelBackend());
 * ```
 */

// Core types and interfaces
export type { LogLevel, ILogger, LoggerBackend } from './logger';
export type { LoggerBackendOptions } from './backend';

// Logger implementations
export {
  ConsoleLogger,
  StderrLogger,
  NullLogger,
} from './logger';

// Logger factory
export {
  loggerFactory,
  getLogger,
  setLoggerBackend,
  LOG_LEVEL_PRIORITY,
} from './logger';

// Backend utilities
export {
  DEFAULT_LOGGER_BACKEND_OPTIONS,
} from './backend';

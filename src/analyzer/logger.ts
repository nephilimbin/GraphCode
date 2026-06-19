/**
 * Analyzer Logger
 *
 * Self-contained logging owned by the analysis core (mirrors the relevant
 * subset of src/foundation/logger/logger.ts). Exports LogLevel,
 * LOG_LEVEL_PRIORITY, ILogger, ConsoleLogger and getLogger only.
 *
 * BEHAVIOR CHANGE vs foundation logger:
 * - Analyzer logs always go to stdout/stderr and are NOT redirectable to a
 *   VS Code OutputChannel (no LoggerFactory / setLoggerBackend).
 * - getLogger returns a fresh ConsoleLogger per call (no cross-module cache).
 *   Module-level `const log = getLogger('X')` usage is unaffected.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/** Log level priority (lower = more verbose) */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Logger interface - all loggers implement this
 */
export interface ILogger {
  readonly level: LogLevel;
  setLevel(level: LogLevel): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

type NodeWritable = { write: (chunk: string) => boolean };

function getNodeStream(kind: 'stdout' | 'stderr'): NodeWritable | null {
  const maybeProcess = (globalThis as unknown as { process?: { stdout?: NodeWritable; stderr?: NodeWritable } }).process;
  const stream = kind === 'stdout' ? maybeProcess?.stdout : maybeProcess?.stderr;
  return stream?.write ? stream : null;
}

function writeLine(stream: NodeWritable | null, message: string): void {
  if (!stream) return;
  stream.write(message.endsWith('\n') ? message : `${message}\n`);
}

/**
 * Format error-like objects
 */
function formatErrorLike(arg: { name?: unknown; message?: unknown; stack?: unknown }): string | null {
  const name = typeof arg.name === 'string' ? arg.name : undefined;
  const message = typeof arg.message === 'string' ? arg.message : undefined;
  const stack = typeof arg.stack === 'string' ? arg.stack : undefined;
  if (!name && !message) return null;
  const errorPrefix = `${name ?? 'Error'}: ${message ?? ''}`;
  return stack ? `${errorPrefix}\n${stack}` : errorPrefix;
}

/**
 * Format a single argument
 */
function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg && typeof arg === 'object') {
    const formatted = formatErrorLike(arg);
    if (formatted) return formatted;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Format log arguments for output
 */
function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  return ' ' + args.map(formatArg).join(' ');
}

/**
 * Console Logger - writes to Node.js stdout/stderr when available.
 */
export class ConsoleLogger implements ILogger {
  private _level: LogLevel;
  private readonly prefix: string;

  constructor(prefix: string = '', level: LogLevel = 'info') {
    this.prefix = prefix ? `[${prefix}]` : '';
    this._level = level;
  }

  get level(): LogLevel {
    return this._level;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this._level];
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} ${this.prefix} [${level.toUpperCase()}] ${message}`;
  }

  private logTo(stream: 'stdout' | 'stderr', level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return;
    writeLine(getNodeStream(stream), this.formatMessage(level, message + formatArgs(args)));
  }

  debug(message: string, ...args: unknown[]): void {
    this.logTo('stdout', 'debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.logTo('stdout', 'info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.logTo('stderr', 'warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.logTo('stderr', 'error', message, args);
  }
}

/**
 * Convenience function to get a logger.
 * Returns a fresh ConsoleLogger writing to stdout/stderr (not redirectable).
 */
export function getLogger(prefix: string): ILogger {
  return new ConsoleLogger(prefix);
}

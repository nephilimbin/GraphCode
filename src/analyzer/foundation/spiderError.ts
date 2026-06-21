/**
 * SpiderError — Spider 分析错误类与错误码。
 *
 * 从 foundation/types.ts 抽出(类型集合文件不应含 class 定义;错误类独立成模块)。
 * foundation/types.ts re-export 保现有 import 路径不变。
 */

/**
 * Error codes for Spider analysis errors
 */
export enum SpiderErrorCode {
  /** File not found or unreadable */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** File read permission denied */
  PERMISSION_DENIED = "PERMISSION_DENIED",
  /** File is too large to process */
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  /** Parse error in file content */
  PARSE_ERROR = "PARSE_ERROR",
  /** Module resolution failed */
  RESOLUTION_FAILED = "RESOLUTION_FAILED",
  /** Operation timeout */
  TIMEOUT = "TIMEOUT",
  /** Circular dependency detected */
  CIRCULAR_DEPENDENCY = "CIRCULAR_DEPENDENCY",
  /** Unknown or unclassified error */
  UNKNOWN = "UNKNOWN",
  /** Reverse index not ready (dead code scan guard) */
  INDEX_NOT_READY = "INDEX_NOT_READY",
}

/**
 * Custom error class for Spider analysis errors with structured metadata
 */
export class SpiderError extends Error {
  readonly code: SpiderErrorCode;
  readonly filePath?: string;
  readonly cause?: Error;
  readonly timestamp: number;

  constructor(
    message: string,
    code: SpiderErrorCode,
    options?: {
      filePath?: string;
      cause?: Error;
    },
  ) {
    super(message);
    this.name = "SpiderError";
    this.code = code;
    this.filePath = options?.filePath;
    this.cause = options?.cause;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SpiderError);
    }
  }

  /**
   * Create a SpiderError from a native Error, classifying the error code
   */
  static fromError(error: unknown, filePath?: string): SpiderError {
    if (error instanceof SpiderError) {
      return error;
    }

    const cause = error instanceof Error ? error : undefined;
    const message =
      cause?.message ??
      (error !== null && typeof error === "object"
        ? JSON.stringify(error)
        : String(error));

    // Classify error based on message/code
    let code = SpiderErrorCode.UNKNOWN;
    if (cause) {
      const errCode = (cause as NodeJS.ErrnoException).code;
      if (errCode === "ENOENT") {
        code = SpiderErrorCode.FILE_NOT_FOUND;
      } else if (errCode === "EACCES" || errCode === "EPERM") {
        code = SpiderErrorCode.PERMISSION_DENIED;
      } else if (message.includes("too large") || errCode === "EFBIG") {
        code = SpiderErrorCode.FILE_TOO_LARGE;
      } else if (message.includes("parse") || message.includes("syntax")) {
        code = SpiderErrorCode.PARSE_ERROR;
      } else if (message.includes("timeout") || errCode === "ETIMEDOUT") {
        code = SpiderErrorCode.TIMEOUT;
      }
    }

    return new SpiderError(message, code, { filePath, cause });
  }

  /**
   * Check if error is recoverable (can continue processing other files)
   */
  isRecoverable(): boolean {
    return [
      SpiderErrorCode.FILE_NOT_FOUND,
      SpiderErrorCode.PERMISSION_DENIED,
      SpiderErrorCode.PARSE_ERROR,
      SpiderErrorCode.RESOLUTION_FAILED,
    ].includes(this.code);
  }

  /**
   * Get a user-friendly error message
   */
  toUserMessage(): string {
    switch (this.code) {
      case SpiderErrorCode.FILE_NOT_FOUND:
        return `File not found: ${this.filePath || "unknown"}`;
      case SpiderErrorCode.PERMISSION_DENIED:
        return `Permission denied: ${this.filePath || "unknown"}`;
      case SpiderErrorCode.FILE_TOO_LARGE:
        return `File too large to process: ${this.filePath || "unknown"}`;
      case SpiderErrorCode.PARSE_ERROR:
        return `Failed to parse: ${this.filePath || "unknown"}`;
      case SpiderErrorCode.RESOLUTION_FAILED:
        return `Could not resolve module in: ${this.filePath || "unknown"}`;
      case SpiderErrorCode.TIMEOUT:
        return `Operation timed out`;
      case SpiderErrorCode.CIRCULAR_DEPENDENCY:
        return `Circular dependency detected`;
      default:
        return this.message;
    }
  }

  /**
   * Serialize error for logging/transport
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      filePath: this.filePath,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

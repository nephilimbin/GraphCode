/**
 * DependonError — analysis error class and error codes.
 *
 * @module dependon/core
 */

/** Error codes for analysis errors */
export enum DependonErrorCode {
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

/** Custom error class for analysis errors with structured metadata */
export class DependonError extends Error {
  readonly code: DependonErrorCode;
  readonly filePath?: string;
  readonly cause?: Error;
  readonly timestamp: number;

  constructor(
    message: string,
    code: DependonErrorCode,
    options?: {
      filePath?: string;
      cause?: Error;
    },
  ) {
    super(message);
    this.name = "DependonError";
    this.code = code;
    this.filePath = options?.filePath;
    this.cause = options?.cause;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DependonError);
    }
  }

  /** Create a DependonError from a native Error, classifying the error code */
  static fromError(error: unknown, filePath?: string): DependonError {
    if (error instanceof DependonError) {
      return error;
    }

    const cause = error instanceof Error ? error : undefined;
    const message =
      cause?.message ??
      (error !== null && typeof error === "object"
        ? JSON.stringify(error)
        : String(error));

    // Classify error based on message/code
    let code = DependonErrorCode.UNKNOWN;
    if (cause) {
      const errCode = (cause as NodeJS.ErrnoException).code;
      if (errCode === "ENOENT") {
        code = DependonErrorCode.FILE_NOT_FOUND;
      } else if (errCode === "EACCES" || errCode === "EPERM") {
        code = DependonErrorCode.PERMISSION_DENIED;
      } else if (message.includes("too large") || errCode === "EFBIG") {
        code = DependonErrorCode.FILE_TOO_LARGE;
      } else if (message.includes("parse") || message.includes("syntax")) {
        code = DependonErrorCode.PARSE_ERROR;
      } else if (message.includes("timeout") || errCode === "ETIMEDOUT") {
        code = DependonErrorCode.TIMEOUT;
      }
    }

    return new DependonError(message, code, { filePath, cause });
  }

  /** Check if error is recoverable (can continue processing other files) */
  isRecoverable(): boolean {
    return [
      DependonErrorCode.FILE_NOT_FOUND,
      DependonErrorCode.PERMISSION_DENIED,
      DependonErrorCode.PARSE_ERROR,
      DependonErrorCode.RESOLUTION_FAILED,
    ].includes(this.code);
  }

  /** Get a user-friendly error message */
  toUserMessage(): string {
    switch (this.code) {
      case DependonErrorCode.FILE_NOT_FOUND:
        return `File not found: ${this.filePath || "unknown"}`;
      case DependonErrorCode.PERMISSION_DENIED:
        return `Permission denied: ${this.filePath || "unknown"}`;
      case DependonErrorCode.FILE_TOO_LARGE:
        return `File too large to process: ${this.filePath || "unknown"}`;
      case DependonErrorCode.PARSE_ERROR:
        return `Failed to parse: ${this.filePath || "unknown"}`;
      case DependonErrorCode.RESOLUTION_FAILED:
        return `Could not resolve module in: ${this.filePath || "unknown"}`;
      case DependonErrorCode.TIMEOUT:
        return `Operation timed out`;
      case DependonErrorCode.CIRCULAR_DEPENDENCY:
        return `Circular dependency detected`;
      default:
        return this.message;
    }
  }

  /** Serialize error for logging/transport */
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

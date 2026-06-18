/**
 * Core utility types used across the GraphCode application.
 * Provides common type patterns for error handling, optional values,
 * and async operations.
 */

/**
 * Represents a result that can either be a success with a value or a failure with an error.
 * This pattern replaces try-catch for explicit error handling in business logic.
 *
 * @example
 * ```typescript
 * async function parseFile(filePath: string): Promise<Result<AST, ParseError>> {
 *   try {
 *     const ast = await parser.parse(filePath)
 *     return { success: true, data: ast }
 *   } catch (error) {
 *     return { success: false, error: new ParseError(error.message) }
 *   }
 * }
 * ```
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Creates a successful Result with the given data.
 */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/**
 * Creates a failed Result with the given error.
 */
export function err<E extends Error>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Represents an optional value that can either be some (with a value) or none.
 * This pattern is more explicit than using `null` or `undefined`.
 *
 * @example
 * ```typescript
 * function findSymbol(id: string): Option<Symbol> {
 *   const symbol = symbols.get(id)
 *   return symbol !== undefined ? some(symbol) : none
 * }
 * ```
 */
export type Option<T> = { isSome: true; value: T } | { isSome: false };

/**
 * Creates an Option with a value.
 */
export function some<T>(value: T): Option<T> {
  return { isSome: true, value };
}

/**
 * Represents no value (equivalent to None/Nothing in other languages).
 */
export const none: Option<never> = { isSome: false };

/**
 * Checks if an Option has a value.
 */
export function isSome<T>(option: Option<T>): option is { isSome: true; value: T } {
  return option.isSome;
}

/**
 * Extracts the value from an Option, or returns a default if none.
 */
export function unwrapOr<T>(option: Option<T>, defaultValue: T): T {
  return option.isSome ? option.value : defaultValue;
}

/**
 * A generic callback function type.
 */
export type Callback<T = void> = () => T;

/**
 * A generic async function type.
 */
export type AsyncFunction<T = unknown> = (...args: unknown[]) => Promise<T>;

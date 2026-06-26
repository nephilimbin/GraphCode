/**
 * Event loop yield — dependon core.
 *
 * @module dependon/core
 */

/** Yield control to the event loop to avoid blocking the host runtime. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

/** Maximum time in ms between yields to event loop (50ms = 20 yields/sec) */
export const YIELD_INTERVAL_MS = 50;

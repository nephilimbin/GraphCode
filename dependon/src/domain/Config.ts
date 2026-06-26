/**
 * Analyzer configuration.
 *
 * @module dependon/domain
 */

/** Configuration for constructing an {@link Analyzer} instance */
export interface AnalyzerConfig {
  rootDir: string;
  tsConfigPath?: string;
  extensionPath?: string;
  maxDepth?: number;
  excludeNodeModules?: boolean;
  /** Interval for worker progress reporting (defaults to 100 files) */
  indexingProgressInterval?: number;
  /** Enable reverse index for O(1) reverse dependency lookups */
  enableReverseIndex?: boolean;
  /** Number of files to process in parallel during indexing */
  indexingConcurrency?: number;
  /** Maximum cache size for dependency results (0 = unlimited) */
  maxCacheSize?: number;
  /** Maximum cache size for symbol analysis results (0 = unlimited) */
  maxSymbolCacheSize?: number;
  /** Maximum files to keep in the symbol analyzer's memory (default: 100) */
  maxSymbolAnalyzerFiles?: number;
}

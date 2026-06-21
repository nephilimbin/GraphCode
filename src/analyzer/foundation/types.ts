export { normalizePath, normalizePathForComparison } from "./path";
// SpiderError / SpiderErrorCode 抽出到 ./spiderError(错误类独立);此处 re-export 保现有 import 不变。
export { SpiderError, SpiderErrorCode } from "./spiderError";

/**
 * Type of import/dependency statement
 */
export type DependencyType = "import" | "require" | "export" | "dynamic";

export interface Dependency {
  path: string;
  type: DependencyType;
  line: number;
  module: string; // Original module specifier
}

export interface SpiderConfig {
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
  /** Maximum files to keep in SymbolAnalyzer memory (default: 100) */
  maxSymbolAnalyzerFiles?: number;
}

export interface ParsedImport {
  module: string;
  type: DependencyType;
  line: number;
}

/**
 * Entry in the reverse index mapping a target file to its referencing files
 */
export interface ReverseIndexEntry {
  /** The source file that imports the target */
  sourcePath: string;
  /** Type of import */
  type: DependencyType;
  /** Line number of the import statement */
  line: number;
  /** Original module specifier */
  module: string;
}

/**
 * File hash for staleness detection (uses mtime + size for performance)
 */
export interface FileHash {
  /** File modification time in milliseconds */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Progress callback for indexing operations
 */
export type IndexingProgressCallback = (
  processed: number,
  total: number,
  currentFile?: string,
) => void;

/**
 * Serializable format for persisting the reverse index
 */
export interface SerializedReverseIndex {
  version: number;
  timestamp: number;
  rootDir: string;
  /** Map of target path -> array of referencing entries */
  reverseMap: Record<string, ReverseIndexEntry[]>;
  /** Map of file path -> file hash */
  fileHashes: Record<string, FileHash>;
}

export interface SymbolInfo {
  name: string;
  kind: string; // 'Function', 'Class', 'Interface', 'Variable', etc.
  line: number;
  isExported: boolean;
  id: string; // Unique ID: filePath:name
  parentSymbolId?: string; // Parent class/namespace ID (for methods/properties)
  category: "function" | "class" | "variable" | "interface" | "type" | "other";
}

export interface SymbolDependency {
  sourceSymbolId: string; // The symbol using the dependency (or 'file' if top-level)
  targetSymbolId: string; // The symbol being used
  targetFilePath: string;
  /** Whether this is a type-only import (interface, type alias) vs runtime code */
  isTypeOnly?: boolean;
}

/**
 * Language-agnostic analyzer interface for parsing imports and resolving paths.
 * Each language (TypeScript, Python, Rust) implements this interface.
 */
export interface ILanguageAnalyzer {
  /**
   * Parse imports/dependencies from a file.
   * @param filePath Absolute path to the file to parse
   * @returns Array of dependencies found in the file
   */
  parseImports(filePath: string): Promise<Dependency[]>;

  /**
   * Resolve a module specifier to an absolute file path.
   * @param fromFile The file containing the import
   * @param moduleSpecifier The import path (e.g., './utils', '@/components', 'lodash')
   * @returns Resolved absolute path or null if cannot resolve
   */
  resolvePath(
    fromFile: string,
    moduleSpecifier: string,
  ): Promise<string | null>;
}

/**
 * Language-agnostic symbol analyzer interface for extracting symbols and dependencies.
 * Provides AST-level analysis for function/class/method dependencies.
 */
export interface ISymbolAnalyzer {
  /**
   * Analyze a file and extract symbols with their dependencies.
   * @param filePath Absolute path to the file to analyze
   * @returns Map of symbol IDs to symbol information
   */
  analyzeFile(filePath: string): Promise<Map<string, SymbolInfo>>;

  /**
   * Get symbol-level dependencies for a file.
   * @param filePath Absolute path to the file
   * @returns Array of symbol dependencies
   */
  getSymbolDependencies(filePath: string): Promise<SymbolDependency[]>;
}

// ---------------------------------------------------------------------------
// Symbol graph types (self-owned; mirrors src/foundation/types/symbol-types.ts).
// NOTE: SymbolInfo/SymbolDependency above are the analyzer's OWN definitions
// (different fields from foundation's) and are intentionally NOT replaced.
// ---------------------------------------------------------------------------

export interface SymbolNode {
  id: string;
  name: string;
  originalName?: string;
  kind: number;
  type: "class" | "function" | "variable";
  range: { start: number; end: number };
  isExported: boolean;
  isExternal: boolean;
  parentSymbolId?: string;
}

export interface CallEdge {
  source: string;
  target: string;
  relation: "calls" | "references";
  direction?: "outgoing" | "incoming";
  line: number;
}

export type CycleType =
  | "self-recursive"
  | "mutual-recursive"
  | "complex";

export interface IntraFileGraph {
  filePath: string;
  nodes: SymbolNode[];
  edges: CallEdge[];
  incomingEdges?: CallEdge[];
  hasCycle: boolean;
  cycleNodes?: string[];
  cycleType?: CycleType;
}

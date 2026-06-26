import type { Dependency } from "./Dependency";

/**
 * Symbol-level types and the language analyzer contracts.
 *
 * @module dependon/domain
 */

/** Symbol information extracted from a source file */
export interface SymbolInfo {
  name: string;
  kind: string; // 'Function', 'Class', 'Interface', 'Variable', etc.
  line: number;
  isExported: boolean;
  id: string; // Unique ID: filePath:name
  parentSymbolId?: string; // Parent class/namespace ID (for methods/properties)
  category: "function" | "class" | "variable" | "interface" | "type" | "other";
}

/** A symbol-level dependency (which symbol uses which) */
export interface SymbolDependency {
  sourceSymbolId: string; // The symbol using the dependency (or 'file' if top-level)
  targetSymbolId: string; // The symbol being used
  targetFilePath: string;
  /** Whether this is a type-only import (interface, type alias) vs runtime code */
  isTypeOnly?: boolean;
}

/**
 * Language-agnostic analyzer interface for parsing imports and resolving paths.
 * Each language (TypeScript, Python, Rust, ...) implements this interface.
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

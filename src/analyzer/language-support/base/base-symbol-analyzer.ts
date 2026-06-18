/**
 * Base Symbol Analyzer Module
 *
 * Abstract base class for language-specific symbol analyzers.
 * Defines the common interface and workflow for symbol extraction.
 */

import type { SymbolNode, IntraFileGraph } from '@/foundation/types';

/**
 * Symbol analysis result
 */
export interface SymbolAnalysisResult {
  symbols: SymbolNode[];
  graph: IntraFileGraph;
}

/**
 * Abstract base class for symbol analyzers
 * Provides a common interface and workflow for language-specific implementations
 */
export abstract class BaseSymbolAnalyzer {
  /**
   * Analyze a file and extract symbols
   * @param filePath - Path to the file to analyze
   * @param content - File content
   * @returns Symbol analysis result
   */
  abstract analyzeFile(filePath: string, content: string): Promise<SymbolAnalysisResult>;

  /**
   * Check if this analyzer supports the given file
   * @param filePath - Path to the file
   * @returns true if the file is supported
   */
  abstract supports(filePath: string): boolean;

  /**
   * Get the language ID this analyzer supports
   * @returns Language ID (e.g., 'python', 'typescript')
   */
  abstract getLanguageId(): string;

  /**
   * Common workflow template method
   * Subclasses can override individual steps
   */
  async analyze(filePath: string, content: string): Promise<SymbolAnalysisResult> {
    // Template method pattern
    const symbols = await this.extractSymbols(filePath, content);
    const graph = this.buildGraph(filePath, symbols);

    return { symbols, graph };
  }

  /**
   * Extract symbols from file content
   * To be implemented by subclasses
   */
  protected abstract extractSymbols(
    filePath: string,
    content: string
  ): Promise<SymbolNode[]>;

  /**
   * Build intra-file graph from symbols
   * Default implementation for simple graphs
   */
  protected buildGraph(filePath: string, symbols: SymbolNode[]): IntraFileGraph {
    const edges = this.extractEdges(symbols);
    const hasCycle = this.detectCycle(edges);

    return {
      filePath,
      nodes: symbols,
      edges,
      hasCycle,
      cycleNodes: hasCycle ? this.getCycleNodes(edges) : undefined,
      cycleType: hasCycle ? this.getCycleType(edges) : undefined,
    };
  }

  /**
   * Extract edges from symbols
   * To be overridden by subclasses for language-specific edge extraction
   */
  protected extractEdges(_symbols: SymbolNode[]): any[] {
    return [];
  }

  /**
   * Detect cycles in the graph
   */
  protected detectCycle(edges: any[]): boolean {
    return false; // Default: no cycle detection
  }

  /**
   * Get cycle nodes
   */
  protected getCycleNodes(_edges: any[]): string[] {
    return [];
  }

  /**
   * Get cycle type
   */
  protected getCycleType(_edges: any[]): any {
    return undefined;
  }
}

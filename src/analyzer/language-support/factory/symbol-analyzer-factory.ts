/**
 * Symbol Analyzer Factory Module
 *
 * Factory for creating language-specific symbol analyzers.
 */

import { BaseSymbolAnalyzer } from '../base/base-symbol-analyzer';
import { PythonSymbolAnalyzer } from '../python/python-symbol-analyzer';
import type { SymbolAnalysisResult } from '../base/base-symbol-analyzer';

/**
 * Get a symbol analyzer for the given file
 */
export function getSymbolAnalyzer(filePath: string): BaseSymbolAnalyzer | null {
  const analyzers: BaseSymbolAnalyzer[] = [
    new PythonSymbolAnalyzer(),
    // Add more analyzers here as they are implemented
  ];

  for (const analyzer of analyzers) {
    if (analyzer.supports(filePath)) {
      return analyzer;
    }
  }

  return null;
}

/**
 * Check if a file is supported for symbol analysis
 */
export function isSupportedFile(filePath: string): boolean {
  const analyzer = getSymbolAnalyzer(filePath);
  return analyzer !== null;
}

/**
 * Analyze a file and extract symbols
 */
export async function analyzeFile(
  filePath: string,
  content: string
): Promise<SymbolAnalysisResult | null> {
  const analyzer = getSymbolAnalyzer(filePath);

  if (!analyzer) {
    return null;
  }

  return analyzer.analyzeFile(filePath, content);
}

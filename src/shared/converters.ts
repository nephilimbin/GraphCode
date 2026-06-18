/**
 * Converter utilities for transforming Spider AST data into LSP-compatible format.
 *
 * Shared between the extension layer (SymbolViewService) and the MCP layer.
 */

import { normalizePath } from "./path";

/**
 * Map string kind to LSP SymbolKind number (vscode.SymbolKind enum)
 */
export function mapKindToLspNumber(kind: string): number {
  switch (kind.toLowerCase()) {
    case "function":
    case "method":
      return 12; // Function
    case "class":
      return 5; // Class
    case "variable":
    case "property":
      return 13; // Variable
    case "interface":
      return 11; // Interface
    default:
      return 13; // Variable (default)
  }
}

/**
 * Convert Spider's symbol graph data to LSP format
 */
export function convertSpiderToLspSymbols(spiderData: any): any[] {
  // Placeholder implementation - will be properly implemented when needed
  return [];
}

/**
 * Convert Spider AST data to LSP SymbolInformation format
 * This is the main function used by SymbolViewService
 */
export function convertSpiderToLspFormat(
  spiderData: any,
  filePath: string
): any[] {
  // Placeholder implementation - will be properly implemented when needed
  return [];
}

/**
 * Normalize file paths for consistent comparison
 */
export function normalizeFilePath(filePath: string): string {
  return normalizePath(filePath);
}

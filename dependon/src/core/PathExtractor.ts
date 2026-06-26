import { getLogger } from "./Logger";

/**
 * Path extractor — dependon core.
 *
 * Extract file paths from symbol IDs (format: "filePath:symbolName").
 * Breaks the circular dependency between LanguageService and parsers.
 *
 * @module dependon/core
 */

/**
 * Extract file path from a potential symbol ID (format: "filePath:symbolName").
 * Returns the original path if no colon-delimited symbol name is found.
 *
 * @param pathOrSymbolId - Either a file path or a symbol ID
 * @returns The extracted file path
 */
export function extractFilePath(pathOrSymbolId: string): string {
  // Symbol IDs have format "filePath:symbolName".
  // File paths should not have colons except for Windows drive letters.
  const regex = /^(.+\.(ts|tsx|js|jsx|mjs|cjs|py|pyi|rs|vue|svelte|gql|graphql)):(.+)$/i;
  const match = regex.exec(pathOrSymbolId);

  if (!match) {
    return pathOrSymbolId;
  }

  const filePath = match[1];
  const symbolName = match[3];

  if (!symbolName) {
    return pathOrSymbolId;
  }

  getLogger("PathExtractor").warn(
    `Symbol ID detected where file path expected: ${pathOrSymbolId}. ` +
      `Extracting file path: ${filePath}`,
  );
  return filePath;
}

/**
 * Analyzer Language Detection
 *
 * Self-contained language detection owned by the analysis core (mirrors
 * src/foundation/utils/language-detection.ts).
 */

import * as path from 'node:path';

/**
 * Map of file extensions to language names
 * Used for consistent language detection within the analyzer.
 */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.gql': 'graphql',
  '.graphql': 'graphql',
  '.cs': 'csharp',
  '.csproj': 'csharp',
  '.go': 'go',
  '.java': 'java',
  '.swift': 'swift',
};

/**
 * Detect language from file path or extension
 * @param filePathOrExt - Full file path or just the extension (with or without dot)
 * @returns Language name (e.g., 'typescript', 'python', 'rust') or 'unknown'
 */
export function detectLanguageFromExtension(filePathOrExt: string): string {
  let ext = filePathOrExt;

  // If it's a full path, extract the extension
  if (filePathOrExt.includes('/') || filePathOrExt.includes('\\')) {
    ext = path.extname(filePathOrExt).toLowerCase();
  } else if (ext.startsWith('.')) {
    ext = ext.toLowerCase();
  } else {
    // If it's an extension without dot, add it
    ext = '.' + ext;
    ext = ext.toLowerCase();
  }

  return LANGUAGE_BY_EXTENSION[ext] || 'unknown';
}

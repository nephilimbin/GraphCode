/**
 * Analyzer Constants
 *
 * Self-contained constant definitions owned by the analysis core so it has
 * zero dependencies on the plugin's shared layer. Values mirror
 * src/foundation/constants to preserve behavior, but only the subset the
 * analyzer actually uses is exported here. This keeps the analysis core
 * usable as a standalone, embeddable tool.
 */

// ---------------------------------------------------------------------------
// File Extensions by Language
// ---------------------------------------------------------------------------

/** Python file extensions */
export const PYTHON_EXTENSIONS = ['.py', '.pyi'] as const;

// ---------------------------------------------------------------------------
// Derived Extension Collections
// ---------------------------------------------------------------------------

/** All supported file extensions */
export const SUPPORTED_FILE_EXTENSIONS = [
  '.ts', '.tsx',
  '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.gql', '.graphql',
  '.py', '.pyi',
  '.rs', '.toml',
  '.cs', '.csproj',
  '.go',
  '.java',
  '.swift',
] as const;

/** Extensions supported for LSP-based symbol analysis */
export const SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS = [
  '.ts', '.tsx',
  '.js', '.jsx',
  '.py', '.pyi',
  '.rs',
  '.swift',
] as const;

// ---------------------------------------------------------------------------
// Ignored Directories
// ---------------------------------------------------------------------------

/** Directories to ignore during file analysis */
export const IGNORED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'target',
];

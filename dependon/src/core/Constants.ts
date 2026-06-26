/**
 * Constants — file extensions and ignored directories.
 *
 * Only the subset dependon actually uses is exported here, keeping the core
 * usable as a standalone, embeddable tool.
 *
 * @module dependon/core
 */

/** Python file extensions */
export const PYTHON_EXTENSIONS = ['.py', '.pyi'] as const;

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

/** Extensions supported for AST-based symbol analysis */
export const SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS = [
  '.ts', '.tsx',
  '.js', '.jsx',
  '.py', '.pyi',
  '.rs',
  '.swift',
] as const;

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

/**
 * Application Constants
 *
 * Centralized constant definitions for file extensions, language support,
 * ignored directories, and UI visualization colors.
 */

// ---------------------------------------------------------------------------
// File Extensions by Language
// ---------------------------------------------------------------------------

/** TypeScript file extensions */
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx'] as const;

/** JavaScript file extensions */
export const JAVASCRIPT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'] as const;

/** Python file extensions */
export const PYTHON_EXTENSIONS = ['.py', '.pyi'] as const;

/** Rust file extensions */
export const RUST_EXTENSIONS = ['.rs'] as const;

/** Vue file extensions */
export const VUE_EXTENSIONS = ['.vue'] as const;

/** Svelte file extensions */
export const SVELTE_EXTENSIONS = ['.svelte'] as const;

/** GraphQL file extensions */
export const GRAPHQL_EXTENSIONS = ['.gql', '.graphql'] as const;

/** TOML file extensions (Rust config files) */
export const TOML_EXTENSIONS = ['.toml'] as const;

/** C# file extensions */
export const CSHARP_EXTENSIONS = ['.cs', '.csproj'] as const;

/** Go file extensions */
export const GO_EXTENSIONS = ['.go'] as const;

/** Java file extensions */
export const JAVA_EXTENSIONS = ['.java'] as const;

/** Swift file extensions */
export const SWIFT_EXTENSIONS = ['.swift'] as const;

// ---------------------------------------------------------------------------
// Derived Extension Collections
// ---------------------------------------------------------------------------

/** All supported file extensions */
export const SUPPORTED_FILE_EXTENSIONS = [
  ...TYPESCRIPT_EXTENSIONS,
  ...JAVASCRIPT_EXTENSIONS,
  ...VUE_EXTENSIONS,
  ...SVELTE_EXTENSIONS,
  ...GRAPHQL_EXTENSIONS,
  ...PYTHON_EXTENSIONS,
  ...RUST_EXTENSIONS,
  ...TOML_EXTENSIONS,
  ...CSHARP_EXTENSIONS,
  ...GO_EXTENSIONS,
  ...JAVA_EXTENSIONS,
  ...SWIFT_EXTENSIONS,
] as const;

/** Extensions supported for LSP-based symbol analysis */
export const SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS = [
  ...TYPESCRIPT_EXTENSIONS,
  ...JAVASCRIPT_EXTENSIONS,
  ...PYTHON_EXTENSIONS,
  ...RUST_EXTENSIONS,
  ...SWIFT_EXTENSIONS,
] as const;

// ---------------------------------------------------------------------------
// File Patterns
// ---------------------------------------------------------------------------

/** Unified regex for source files we analyze across extension/webview/mcp */
export const SUPPORTED_SOURCE_FILE_REGEX =
  /\.(ts|tsx|js|jsx|vue|svelte|gql|graphql|py|pyi|rs|toml|cs|csproj|go|java|swift)$/;

/** Glob pattern for file watching */
export const WATCH_GLOB =
  '**/*.{ts,tsx,js,jsx,vue,svelte,gql,graphql,py,pyi,rs,toml,cs,csproj,go,java,swift}';

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
] as const;

// ---------------------------------------------------------------------------
// Language Visualization Colors
// ---------------------------------------------------------------------------

/**
 * Language-specific colors for UI visualization.
 * Used in webview for syntax highlighting, borders, and icons.
 */
export const LANGUAGE_COLORS: Record<string, string> = {
  // TypeScript
  typescript: '#3178c6',
  // JavaScript
  javascript: '#f7df1e',
  // Python
  python: '#3776ab',
  // Rust
  rust: '#ce422b',
  // Vue
  vue: '#41b883',
  // Svelte
  svelte: '#ff3e00',
  // GraphQL
  graphql: '#e535ab',
  // TOML (Rust config)
  toml: '#9c4221',
  // C#
  csharp: '#9b4f96',
  // Go
  go: '#00acd7',
  // Java
  java: '#f8981d',
  // Swift
  swift: '#f05138',
  // Unknown/default
  unknown: '#6b6b6b',
} as const;

/**
 * File extension to color mapping for border colors in graph visualization.
 * Maps file extensions to their respective language colors.
 */
export const EXTENSION_COLORS: Record<string, string> = {
  '.ts': LANGUAGE_COLORS.typescript,
  '.tsx': LANGUAGE_COLORS.typescript,
  '.mts': LANGUAGE_COLORS.typescript,
  '.cts': LANGUAGE_COLORS.typescript,
  '.js': LANGUAGE_COLORS.javascript,
  '.jsx': LANGUAGE_COLORS.javascript,
  '.mjs': LANGUAGE_COLORS.javascript,
  '.cjs': LANGUAGE_COLORS.javascript,
  '.py': LANGUAGE_COLORS.python,
  '.pyi': LANGUAGE_COLORS.python,
  '.rs': LANGUAGE_COLORS.rust,
  '.vue': LANGUAGE_COLORS.vue,
  '.svelte': LANGUAGE_COLORS.svelte,
  '.gql': LANGUAGE_COLORS.graphql,
  '.graphql': LANGUAGE_COLORS.graphql,
  '.toml': LANGUAGE_COLORS.toml,
  '.cs': LANGUAGE_COLORS.csharp,
  '.csproj': LANGUAGE_COLORS.csharp,
  '.go': LANGUAGE_COLORS.go,
  '.java': LANGUAGE_COLORS.java,
  '.swift': LANGUAGE_COLORS.swift,
} as const;

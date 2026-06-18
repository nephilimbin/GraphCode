/**
 * Unit tests for Constants module.
 */

import { describe, it, expect } from 'vitest';
import {
  TYPESCRIPT_EXTENSIONS,
  JAVASCRIPT_EXTENSIONS,
  PYTHON_EXTENSIONS,
  RUST_EXTENSIONS,
  VUE_EXTENSIONS,
  SVELTE_EXTENSIONS,
  GRAPHQL_EXTENSIONS,
  CSHARP_EXTENSIONS,
  GO_EXTENSIONS,
  JAVA_EXTENSIONS,
  SUPPORTED_FILE_EXTENSIONS,
  SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS,
  SUPPORTED_SOURCE_FILE_REGEX,
  WATCH_GLOB,
  IGNORED_DIRECTORIES,
  LANGUAGE_COLORS,
  EXTENSION_COLORS,
} from '../constants';

describe('File Extensions', () => {
  describe('Language-specific extensions', () => {
    it('should define TypeScript extensions', () => {
      expect(TYPESCRIPT_EXTENSIONS).toEqual(['.ts', '.tsx']);
    });

    it('should define JavaScript extensions', () => {
      expect(JAVASCRIPT_EXTENSIONS).toEqual(['.js', '.jsx', '.mjs', '.cjs']);
    });

    it('should define Python extensions', () => {
      expect(PYTHON_EXTENSIONS).toEqual(['.py', '.pyi']);
    });

    it('should define Rust extensions', () => {
      expect(RUST_EXTENSIONS).toEqual(['.rs']);
    });

    it('should define Vue extensions', () => {
      expect(VUE_EXTENSIONS).toEqual(['.vue']);
    });

    it('should define Svelte extensions', () => {
      expect(SVELTE_EXTENSIONS).toEqual(['.svelte']);
    });

    it('should define GraphQL extensions', () => {
      expect(GRAPHQL_EXTENSIONS).toEqual(['.gql', '.graphql']);
    });

    it('should define C# extensions', () => {
      expect(CSHARP_EXTENSIONS).toEqual(['.cs', '.csproj']);
    });

    it('should define Go extensions', () => {
      expect(GO_EXTENSIONS).toEqual(['.go']);
    });

    it('should define Java extensions', () => {
      expect(JAVA_EXTENSIONS).toEqual(['.java']);
    });
  });

  describe('Derived extension collections', () => {
    it('should include all supported file extensions', () => {
      expect(SUPPORTED_FILE_EXTENSIONS.length).toBeGreaterThan(0);
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.ts');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.js');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.py');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.rs');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.vue');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.go');
      expect(SUPPORTED_FILE_EXTENSIONS).toContain('.java');
    });

    it('should include extensions for symbol analysis', () => {
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).toContain('.ts');
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).toContain('.js');
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).toContain('.py');
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).toContain('.rs');
      // Should NOT include unsupported languages
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).not.toContain('.go');
      expect(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS).not.toContain('.java');
    });
  });
});

describe('File Patterns', () => {
  it('should match supported source files with regex', () => {
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.ts')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.tsx')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.js')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.py')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.rs')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.vue')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.go')).toBe(true);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.java')).toBe(true);
    // Should NOT match unsupported files
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.md')).toBe(false);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.txt')).toBe(false);
    expect(SUPPORTED_SOURCE_FILE_REGEX.test('.json')).toBe(false);
  });

  it('should provide a glob pattern for file watching', () => {
    expect(WATCH_GLOB).toContain('**/*');
    expect(WATCH_GLOB).toContain('{ts,tsx');
    expect(WATCH_GLOB).toContain('js,jsx');
    expect(WATCH_GLOB).toContain('py,pyi');
    expect(WATCH_GLOB).toContain('rs');
    expect(WATCH_GLOB).toContain('go,java');
  });
});

describe('Ignored Directories', () => {
  it('should include common ignored directories', () => {
    expect(IGNORED_DIRECTORIES).toContain('node_modules');
    expect(IGNORED_DIRECTORIES).toContain('.git');
    expect(IGNORED_DIRECTORIES).toContain('dist');
    expect(IGNORED_DIRECTORIES).toContain('build');
    expect(IGNORED_DIRECTORIES).toContain('__pycache__');
    expect(IGNORED_DIRECTORIES).toContain('target');
    expect(IGNORED_DIRECTORIES).toContain('venv');
  });

  it('should be a readonly array', () => {
    // TypeScript should enforce this as const
    expect(Array.isArray(IGNORED_DIRECTORIES)).toBe(true);
  });
});

describe('Language Colors', () => {
  it('should define colors for all supported languages', () => {
    expect(LANGUAGE_COLORS.typescript).toBeDefined();
    expect(LANGUAGE_COLORS.javascript).toBeDefined();
    expect(LANGUAGE_COLORS.python).toBeDefined();
    expect(LANGUAGE_COLORS.rust).toBeDefined();
    expect(LANGUAGE_COLORS.vue).toBeDefined();
    expect(LANGUAGE_COLORS.svelte).toBeDefined();
    expect(LANGUAGE_COLORS.graphql).toBeDefined();
    expect(LANGUAGE_COLORS.csharp).toBeDefined();
    expect(LANGUAGE_COLORS.go).toBeDefined();
    expect(LANGUAGE_COLORS.java).toBeDefined();
    expect(LANGUAGE_COLORS.unknown).toBeDefined();
  });

  it('should use valid hex color format', () => {
    const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

    Object.values(LANGUAGE_COLORS).forEach(color => {
      expect(color).toMatch(hexColorRegex);
    });
  });

  it('should map extensions to language colors', () => {
    expect(EXTENSION_COLORS['.ts']).toBe(LANGUAGE_COLORS.typescript);
    expect(EXTENSION_COLORS['.tsx']).toBe(LANGUAGE_COLORS.typescript);
    expect(EXTENSION_COLORS['.js']).toBe(LANGUAGE_COLORS.javascript);
    expect(EXTENSION_COLORS['.py']).toBe(LANGUAGE_COLORS.python);
    expect(EXTENSION_COLORS['.rs']).toBe(LANGUAGE_COLORS.rust);
    expect(EXTENSION_COLORS['.vue']).toBe(LANGUAGE_COLORS.vue);
    expect(EXTENSION_COLORS['.go']).toBe(LANGUAGE_COLORS.go);
    expect(EXTENSION_COLORS['.java']).toBe(LANGUAGE_COLORS.java);
  });

  it('should include all language extensions', () => {
    // Check that all SUPPORTED_FILE_EXTENSIONS have a color mapping
    SUPPORTED_FILE_EXTENSIONS.forEach(ext => {
      expect(EXTENSION_COLORS[ext]).toBeDefined();
    });
  });
});

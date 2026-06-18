/**
 * Unit tests for Language Detection utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLanguageFromExtension,
  isLanguage,
  getExtensionsForLanguage,
  LANGUAGE_BY_EXTENSION,
} from '../language-detection';

describe('LANGUAGE_BY_EXTENSION', () => {
  it('should map extensions to languages', () => {
    expect(LANGUAGE_BY_EXTENSION['.ts']).toBe('typescript');
    expect(LANGUAGE_BY_EXTENSION['.js']).toBe('javascript');
    expect(LANGUAGE_BY_EXTENSION['.py']).toBe('python');
    expect(LANGUAGE_BY_EXTENSION['.rs']).toBe('rust');
    expect(LANGUAGE_BY_EXTENSION['.go']).toBe('go');
    expect(LANGUAGE_BY_EXTENSION['.java']).toBe('java');
  });

  it('should include all supported languages', () => {
    const languages = Object.values(LANGUAGE_BY_EXTENSION);
    expect(languages).toContain('typescript');
    expect(languages).toContain('javascript');
    expect(languages).toContain('python');
    expect(languages).toContain('rust');
    expect(languages).toContain('vue');
    expect(languages).toContain('svelte');
    expect(languages).toContain('graphql');
    expect(languages).toContain('csharp');
    expect(languages).toContain('go');
    expect(languages).toContain('java');
  });
});

describe('detectLanguageFromExtension', () => {
  describe('with full file paths', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguageFromExtension('/path/to/file.ts')).toBe('typescript');
      expect(detectLanguageFromExtension('/path/to/file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguageFromExtension('/path/to/file.js')).toBe('javascript');
      expect(detectLanguageFromExtension('/path/to/file.jsx')).toBe('javascript');
      expect(detectLanguageFromExtension('/path/to/file.mjs')).toBe('javascript');
    });

    it('should detect Python files', () => {
      expect(detectLanguageFromExtension('/path/to/file.py')).toBe('python');
      expect(detectLanguageFromExtension('/path/to/file.pyi')).toBe('python');
    });

    it('should detect Rust files', () => {
      expect(detectLanguageFromExtension('/path/to/file.rs')).toBe('rust');
    });

    it('should detect Go files', () => {
      expect(detectLanguageFromExtension('/path/to/file.go')).toBe('go');
    });

    it('should detect Java files', () => {
      expect(detectLanguageFromExtension('/path/to/File.java')).toBe('java');
    });

    it('should detect C# files', () => {
      expect(detectLanguageFromExtension('/path/to/file.cs')).toBe('csharp');
      expect(detectLanguageFromExtension('/path/to/file.csproj')).toBe('csharp');
    });

    it('should detect Vue files', () => {
      expect(detectLanguageFromExtension('/path/to/App.vue')).toBe('vue');
    });

    it('should detect Svelte files', () => {
      expect(detectLanguageFromExtension('/path/to/App.svelte')).toBe('svelte');
    });

    it('should detect GraphQL files', () => {
      expect(detectLanguageFromExtension('/path/to/schema.gql')).toBe('graphql');
      expect(detectLanguageFromExtension('/path/to/schema.graphql')).toBe('graphql');
    });

    it('should return unknown for unsupported extensions', () => {
      expect(detectLanguageFromExtension('/path/to/file.md')).toBe('unknown');
      expect(detectLanguageFromExtension('/path/to/file.txt')).toBe('unknown');
      expect(detectLanguageFromExtension('/path/to/file.json')).toBe('unknown');
    });

    it('should be case-insensitive for extensions', () => {
      expect(detectLanguageFromExtension('/path/to/file.TS')).toBe('typescript');
      expect(detectLanguageFromExtension('/path/to/file.JS')).toBe('javascript');
      expect(detectLanguageFromExtension('/path/to/file.PY')).toBe('python');
    });
  });

  describe('with extensions only', () => {
    it('should detect from extension with dot', () => {
      expect(detectLanguageFromExtension('.ts')).toBe('typescript');
      expect(detectLanguageFromExtension('.js')).toBe('javascript');
      expect(detectLanguageFromExtension('.py')).toBe('python');
    });

    it('should detect from extension without dot', () => {
      expect(detectLanguageFromExtension('ts')).toBe('typescript');
      expect(detectLanguageFromExtension('js')).toBe('javascript');
      expect(detectLanguageFromExtension('py')).toBe('python');
      expect(detectLanguageFromExtension('go')).toBe('go');
      expect(detectLanguageFromExtension('java')).toBe('java');
    });

    it('should be case-insensitive', () => {
      expect(detectLanguageFromExtension('.TS')).toBe('typescript');
      expect(detectLanguageFromExtension('JS')).toBe('javascript');
    });

    it('should return unknown for unknown extensions', () => {
      expect(detectLanguageFromExtension('.md')).toBe('unknown');
      expect(detectLanguageFromExtension('unknown')).toBe('unknown');
    });
  });
});

describe('isLanguage', () => {
  it('should return true for matching language', () => {
    expect(isLanguage('/path/to/file.ts', 'typescript')).toBe(true);
    expect(isLanguage('/path/to/file.py', 'python')).toBe(true);
    expect(isLanguage('/path/to/file.rs', 'rust')).toBe(true);
  });

  it('should return false for non-matching language', () => {
    expect(isLanguage('/path/to/file.ts', 'python')).toBe(false);
    expect(isLanguage('/path/to/file.py', 'typescript')).toBe(false);
    expect(isLanguage('/path/to/file.rs', 'javascript')).toBe(false);
  });

  it('should return false for unknown extensions', () => {
    expect(isLanguage('/path/to/file.md', 'typescript')).toBe(false);
    expect(isLanguage('/path/to/file.txt', 'markdown')).toBe(false);
  });

  it('should work with extensions only', () => {
    expect(isLanguage('.ts', 'typescript')).toBe(true);
    expect(isLanguage('py', 'python')).toBe(true);
    expect(isLanguage('js', 'rust')).toBe(false);
  });
});

describe('getExtensionsForLanguage', () => {
  it('should return all TypeScript extensions', () => {
    const extensions = getExtensionsForLanguage('typescript');
    expect(extensions).toContain('.ts');
    expect(extensions).toContain('.tsx');
    expect(extensions).toContain('.mts');
    expect(extensions).toContain('.cts');
  });

  it('should return all JavaScript extensions', () => {
    const extensions = getExtensionsForLanguage('javascript');
    expect(extensions).toContain('.js');
    expect(extensions).toContain('.jsx');
    expect(extensions).toContain('.mjs');
    expect(extensions).toContain('.cjs');
  });

  it('should return all Python extensions', () => {
    const extensions = getExtensionsForLanguage('python');
    expect(extensions).toContain('.py');
    expect(extensions).toContain('.pyi');
  });

  it('should return single extension for single-extension languages', () => {
    expect(getExtensionsForLanguage('rust')).toEqual(['.rs']);
    expect(getExtensionsForLanguage('go')).toEqual(['.go']);
    expect(getExtensionsForLanguage('java')).toEqual(['.java']);
  });

  it('should return empty array for unknown language', () => {
    expect(getExtensionsForLanguage('unknown')).toEqual([]);
    expect(getExtensionsForLanguage('cobol')).toEqual([]);
  });
});

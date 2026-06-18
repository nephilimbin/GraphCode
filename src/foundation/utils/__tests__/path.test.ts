/**
 * Unit tests for Path utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  normalizePathForComparison,
  getRelativePath,
} from '../path';

describe('normalizePath', () => {
  it('should convert backslashes to forward slashes', () => {
    expect(normalizePath('path\\to\\file')).toBe('path/to/file');
  });

  it('should collapse multiple slashes', () => {
    expect(normalizePath('path///to///file')).toBe('path/to/file');
  });

  it('should handle mixed backslashes and forward slashes', () => {
    expect(normalizePath('path\\to/file')).toBe('path/to/file');
  });

  it('should lowercase Windows drive letter', () => {
    expect(normalizePath('C:\\Users\\file')).toBe('c:/Users/file');
    expect(normalizePath('D:/Users/file')).toBe('d:/Users/file');
  });

  it('should remove trailing slash for non-root paths', () => {
    expect(normalizePath('path/to/')).toBe('path/to');
    expect(normalizePath('path/to')).toBe('path/to');
  });

  it('should keep root path intact', () => {
    expect(normalizePath('C:/')).toBe('c:/'); // normalizePath lowercases drive letters
  });

  it('should handle empty string', () => {
    expect(normalizePath('')).toBe('');
  });

  it('should handle Unix-style paths', () => {
    expect(normalizePath('/home/user/file')).toBe('/home/user/file');
    expect(normalizePath('home/user/file')).toBe('home/user/file');
  });
});

describe('normalizePathForComparison', () => {
  it('should normalize path consistently', () => {
    expect(normalizePathForComparison('path\\to\\file')).toBe('path/to/file');
  });

  it('should lowercase Windows drive letter', () => {
    expect(normalizePathForComparison('C:\\Users\\file')).toBe('c:/Users/file');
    expect(normalizePathForComparison('D:/Users/file')).toBe('d:/Users/file');
  });

  it('should remove trailing slash for non-root paths', () => {
    expect(normalizePathForComparison('path/to/')).toBe('path/to');
  });

  it('should keep root path intact', () => {
    expect(normalizePathForComparison('C:/')).toBe('c:/'); // lowercases drive letter
    expect(normalizePathForComparison('c:/')).toBe('c:/');
  });

  it('should handle empty string', () => {
    expect(normalizePathForComparison('')).toBe('');
  });
});

describe('getRelativePath', () => {
  it('should convert absolute path to relative path', () => {
    const result = getRelativePath('/workspace/src/file.ts', '/workspace');
    expect(result).toBe('src/file.ts');
  });

  it('should use forward slashes for relative paths', () => {
    const result = getRelativePath('/workspace/src/file.ts', '/workspace');
    expect(result).toBe('src/file.ts');
  });

  it('should return absolute path if outside workspace', () => {
    const result = getRelativePath('/other/file.ts', '/workspace');
    expect(result).toBe('/other/file.ts');
  });

  it('should return absolute path if parent traversal needed', () => {
    const result = getRelativePath('/workspace/../other/file.ts', '/workspace');
    expect(result).toBe('/workspace/../other/file.ts');
  });

  it('should handle same directory', () => {
    const result = getRelativePath('/workspace/file.ts', '/workspace');
    expect(result).toBe('file.ts');
  });

  it('should handle nested paths', () => {
    const result = getRelativePath('/workspace/src/deeply/nested/file.ts', '/workspace');
    expect(result).toBe('src/deeply/nested/file.ts');
  });
});

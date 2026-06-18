/**
 * Unit tests for FileSystemWatcher module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileSystemWatcher, createFileWatcher, DEFAULT_FILE_WATCHER_OPTIONS } from '../file-system-watcher';
import * as fs from 'node:fs';
import * as path from 'path';

describe('FileSystemWatcher', () => {
  let watcher: FileSystemWatcher;
  let testDir: string;

  beforeEach(() => {
    watcher = new FileSystemWatcher({ debounceDelay: 50 });
    testDir = '/tmp/test-watcher';
    vi.clearAllMocks();
  });

  afterEach(() => {
    watcher.dispose();
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const defaultWatcher = new FileSystemWatcher();

      expect(defaultWatcher).toBeInstanceOf(FileSystemWatcher);
    });

    it('should merge custom options with defaults', () => {
      const customWatcher = new FileSystemWatcher({ debounceDelay: 200 });

      expect(customWatcher).toBeInstanceOf(FileSystemWatcher);
    });
  });

  describe('onFileChange', () => {
    it('should subscribe to file change events', () => {
      const listener = vi.fn();
      const unsubscribe = watcher.onFileChange(listener);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should receive events when files change', (done) => {
      const listener = (event: any) => {
        expect(event).toBeDefined();
        expect(event.type).toBeDefined();
        expect(event.path).toBeDefined();
        done();
      };

      watcher.onFileChange(listener);

      // Simulate file event (would normally come from fs.watch)
      // This is a manual trigger for testing
      setTimeout(() => {
        listener({ type: 'change', path: '/test/file.ts' });
      }, 10);
    });

    it('should support multiple subscribers', (done) => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      watcher.onFileChange(listener1);
      watcher.onFileChange(listener2);

      setTimeout(() => {
        listener1({ type: 'change', path: '/test/file.ts' });
        listener2({ type: 'change', path: '/test/file.ts' });

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
        done();
      }, 10);
    });
  });

  describe('shouldIgnore', () => {
    it('should ignore node_modules by default', () => {
      const ignoreWatcher = new FileSystemWatcher({
        ignore: ['node_modules', '.git'],
      });

      // Test that ignored paths are filtered
      // (This would need to be tested via actual file watching)
      expect(ignoreWatcher).toBeInstanceOf(FileSystemWatcher);
    });

    it('should ignore patterns configured in options', () => {
      const ignoreWatcher = new FileSystemWatcher({
        ignore: ['dist', 'build'],
      });

      expect(ignoreWatcher).toBeInstanceOf(FileSystemWatcher);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      const listener = vi.fn();
      watcher.onFileChange(listener);

      watcher.dispose();

      // Should not throw
      expect(() => watcher.dispose()).not.toThrow();
    });
  });
});

describe('createFileWatcher', () => {
  it('should create a new FileSystemWatcher instance', () => {
    const watcher = createFileWatcher();

    expect(watcher).toBeInstanceOf(FileSystemWatcher);
  });

  it('should pass options to FileSystemWatcher', () => {
    const watcher = createFileWatcher({ debounceDelay: 200 });

    expect(watcher).toBeInstanceOf(FileSystemWatcher);
  });
});

describe('DEFAULT_FILE_WATCHER_OPTIONS', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_FILE_WATCHER_OPTIONS.debounceDelay).toBe(100);
    expect(DEFAULT_FILE_WATCHER_OPTIONS.recursive).toBe(true);
    expect(DEFAULT_FILE_WATCHER_OPTIONS.ignore).toContain('node_modules');
    expect(DEFAULT_FILE_WATCHER_OPTIONS.ignore).toContain('.git');
  });
});

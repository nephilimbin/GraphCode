/**
 * File System Watcher Module
 *
 * Provides file watching capabilities with debouncing and filtering.
 * Foundation layer - VS Code agnostic.
 */

import * as fs from 'node:fs';
import * as path from 'path';
import { EventPublisher } from '../event-publisher';

/**
 * File change event types
 */
export type FileChangeType = 'add' | 'change' | 'unlink';

/**
 * File change event
 */
export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  stats?: fs.Stats;
}

/**
 * File watcher configuration
 */
export interface FileWatcherOptions {
  /** Debounce delay in milliseconds */
  debounceDelay?: number;
  /** Whether to watch recursively */
  recursive?: boolean;
  /** Ignored directories/patterns */
  ignore?: string[];
}

/**
 * Default file watcher options
 */
export const DEFAULT_FILE_WATCHER_OPTIONS: FileWatcherOptions = {
  debounceDelay: 100,
  recursive: true,
  ignore: ['node_modules', '.git', 'dist', 'build'],
};

/**
 * Debounce timer map
 */
interface DebounceState {
  timer: NodeJS.Timeout | null;
  stats: fs.Stats | null;
}

/**
 * File system watcher with debouncing
 */
export class FileSystemWatcher {
  private eventPublisher: EventPublisher;
  private options: FileWatcherOptions;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceState: Map<string, DebounceState> = new Map();

  constructor(options: FileWatcherOptions = {}) {
    this.options = { ...DEFAULT_FILE_WATCHER_OPTIONS, ...options };
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Start watching a file or directory
   */
  watch(targetPath: string): void {
    if (this.watchers.has(targetPath)) {
      return; // Already watching
    }

    try {
      const watcher = fs.watch(
        targetPath,
        { recursive: this.options.recursive },
        (eventType, filename) => {
          if (!filename) return;

          const fullPath = path.join(targetPath, filename);
          this.handleEvent(fullPath, eventType as FileChangeType);
        }
      );

      this.watchers.set(targetPath, watcher);
    } catch (error) {
      console.error(`Failed to watch ${targetPath}:`, error);
    }
  }

  /**
   * Stop watching a file or directory
   */
  unwatch(targetPath: string): void {
    const watcher = this.watchers.get(targetPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(targetPath);
    }
  }

  /**
   * Stop watching all paths
   */
  dispose(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    this.eventPublisher.dispose();
    // Clear all debounce timers
    for (const state of this.debounceState.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.debounceState.clear();
  }

  /**
   * Subscribe to file change events
   */
  onFileChange(listener: (event: FileChangeEvent) => void): () => void {
    return this.eventPublisher.on('file-change', listener);
  }

  /**
   * Handle file system event with debouncing
   */
  private handleEvent(filePath: string, eventType: FileChangeType): void {
    // Check if path should be ignored
    if (this.shouldIgnore(filePath)) {
      return;
    }

    // Get existing debounce state
    let state = this.debounceState.get(filePath);

    // Clear existing timer
    if (state?.timer) {
      clearTimeout(state.timer);
    }

    // Try to get file stats
    let stats: fs.Stats | null = null;
    try {
      stats = fs.statSync(filePath);
    } catch {
      // File might have been deleted
    }

    // Set up new debounce timer
    const timer = setTimeout(() => {
      const event: FileChangeEvent = {
        type: eventType,
        path: filePath,
        stats: stats || undefined,
      };

      this.eventPublisher.emit('file-change', event);

      // Clean up debounce state
      this.debounceState.delete(filePath);
    }, this.options.debounceDelay || 100);

    // Update debounce state
    this.debounceState.set(filePath, { timer, stats });
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(filePath: string): boolean {
    const segments = filePath.split(path.sep);

    return this.options.ignore?.some(pattern => {
      if (segments.includes(pattern)) {
        return true;
      }

      // Simple pattern matching (can be extended)
      return filePath.includes(pattern);
    }) || false;
  }
}

/**
 * Create a file watcher with default options
 */
export function createFileWatcher(options?: FileWatcherOptions): FileSystemWatcher {
  return new FileSystemWatcher(options);
}

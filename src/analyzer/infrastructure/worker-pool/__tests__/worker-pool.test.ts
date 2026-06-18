/**
 * Unit tests for Worker Pool module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkerPoolManager,
  createWorkerPoolManager,
  type WorkerConfig,
} from '../worker-pool';

describe('WorkerPoolManager', () => {
  let manager: WorkerPoolManager;

  beforeEach(() => {
    manager = createWorkerPoolManager({
      extensionPath: '/mock/extension',
    });
    vi.clearAllMocks();
  });

  it('should create manager with default config', () => {
    expect(manager).toBeDefined();
  });

  it('should get indexer worker', () => {
    const indexer = manager.getIndexer();
    expect(indexer).toBeDefined();
  });

  it('should reuse indexer worker instance', () => {
    const indexer1 = manager.getIndexer();
    const indexer2 = manager.getIndexer();
    expect(indexer1).toBe(indexer2);
  });

  it('should get AST worker', () => {
    const astWorker = manager.getAstWorker();
    expect(astWorker).toBeDefined();
  });

  it('should reuse AST worker instance', () => {
    const ast1 = manager.getAstWorker();
    const ast2 = manager.getAstWorker();
    expect(ast1).toBe(ast2);
  });

  it('should create separate workers for indexer and AST', () => {
    const indexer = manager.getIndexer();
    const astWorker = manager.getAstWorker();
    expect(indexer).not.toBe(astWorker);
  });

  it('should dispose all workers', () => {
    manager.getIndexer();
    manager.getAstWorker();

    manager.dispose();

    // After dispose, new instances should be created
    const newIndexer = manager.getIndexer();
    const newAstWorker = manager.getAstWorker();
    expect(newIndexer).toBeDefined();
    expect(newAstWorker).toBeDefined();
  });

  it('should accept custom config', () => {
    const customManager = createWorkerPoolManager({
      extensionPath: '/custom/path',
      maxConcurrency: 4,
    });

    expect(customManager).toBeDefined();
  });
});

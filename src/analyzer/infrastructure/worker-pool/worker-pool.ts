/**
 * Worker Pool Module
 *
 * Manages worker threads for background processing.
 * Provides abstraction for creating and communicating with workers.
 */

import { Worker } from 'node:worker_threads';

/**
 * Worker message types
 */
export type WorkerMessage = {
  id: number;
  type: string;
  data?: unknown;
};

/**
 * Worker response types
 */
export type WorkerResponse =
  | { type: 'success'; id: number; result: unknown }
  | { type: 'error'; id: number; error: string; stack?: string };

/**
 * Worker configuration
 */
export interface WorkerConfig {
  extensionPath?: string;
  maxConcurrency?: number;
}

/**
 * Abstract base class for worker hosts
 */
export abstract class WorkerHost {
  protected worker?: Worker;
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();

  /**
   * Get the path to the worker file
   */
  protected abstract getWorkerPath(): string;

  /**
   * Initialize the worker
   */
  protected initialize(config: WorkerConfig): void {
    const workerPath = this.getWorkerPath();
    this.worker = new Worker(workerPath, {
      workerData: { extensionPath: config.extensionPath },
    });

    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        if (response.type === 'success') {
          pending.resolve(response.result);
        } else {
          pending.reject(new Error(response.error));
        }
        this.pendingRequests.delete(response.id);
      }
    });

    this.worker.on('error', (error: Error) => {
      // Reject all pending requests
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
    });

    this.worker.on('exit', () => {
      // Reject all pending requests
      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error('Worker exited unexpectedly'));
      }
      this.pendingRequests.clear();
    });
  }

  /**
   * Send a message to the worker and wait for response
   */
  protected async sendToWorker<T = unknown>(
    type: string,
    data?: unknown
  ): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = ++this.messageId;
    const message: WorkerMessage = { id, type, data };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage(message);

      // Add timeout to prevent hanging
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Worker request timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Dispose the worker
   */
  protected dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
    this.pendingRequests.clear();
  }
}

/**
 * Indexer Worker Host
 * Manages the background indexing worker
 */
export class IndexerWorkerHost extends WorkerHost {
  private config?: WorkerConfig;

  constructor(config?: WorkerConfig) {
    super();
    this.config = config;
    this.initialize(config ?? {});
  }

  protected getWorkerPath(): string {
    return '/Users/zzb/Documents/Project/GraphCode/dist/indexerWorker.js';
  }

  /**
   * Start indexing
   */
  async startIndexing(config: {
    rootDir: string;
    maxDepth?: number;
    excludeNodeModules?: boolean;
    tsConfigPath?: string;
  }): Promise<void> {
    await this.sendToWorker('start', config);
  }

  /**
   * Cancel indexing
   */
  async cancelIndexing(): Promise<void> {
    await this.sendToWorker('cancel');
  }

  /**
   * Dispose the indexer worker
   */
  dispose(): void {
    super.dispose();
  }
}

/**
 * AST Worker Host
 * Manages the AST analysis worker
 */
export class AstWorkerHost extends WorkerHost {
  private config?: WorkerConfig;

  constructor(config?: WorkerConfig) {
    super();
    this.config = config;
    this.initialize(config ?? {});
  }

  protected getWorkerPath(): string {
    return '/Users/zzb/Documents/Project/GraphCode/dist/astWorker.js';
  }

  /**
   * Analyze a file for symbols and dependencies
   */
  async analyzeFile(filePath: string, content: string): Promise<{
    symbols: unknown[];
    dependencies: unknown[];
  }> {
    return this.sendToWorker('analyzeFile', { filePath, content });
  }

  /**
   * Get internal export dependencies
   */
  async getInternalExportDeps(filePath: string, content: string): Promise<unknown> {
    return this.sendToWorker('getInternalExportDeps', { filePath, content });
  }

  /**
   * Extract signatures from a file
   */
  async extractSignatures(filePath: string, content: string): Promise<unknown> {
    return this.sendToWorker('extractSignatures', { filePath, content });
  }

  /**
   * Analyze breaking changes
   */
  async analyzeBreakingChanges(
    filePath: string,
    oldContent: string,
    newContent: string
  ): Promise<unknown> {
    return this.sendToWorker('analyzeBreakingChanges', {
      filePath,
      oldContent,
      newContent,
    });
  }

  /**
   * Reset the worker state
   */
  async reset(): Promise<void> {
    await this.sendToWorker('reset');
  }

  /**
   * Get file count from the worker
   */
  async getFileCount(): Promise<number> {
    return this.sendToWorker('getFileCount');
  }

  /**
   * Dispose the AST worker
   */
  dispose(): void {
    super.dispose();
  }
}

/**
 * Worker Pool Manager
 * Manages multiple worker hosts
 */
export class WorkerPoolManager {
  private indexerWorker?: IndexerWorkerHost;
  private astWorker?: AstWorkerHost;
  private config: WorkerConfig;

  constructor(config?: WorkerConfig) {
    this.config = config ?? {};
  }

  /**
   * Get or create the indexer worker
   */
  getIndexer(): IndexerWorkerHost {
    if (!this.indexerWorker) {
      this.indexerWorker = new IndexerWorkerHost(this.config);
    }
    return this.indexerWorker;
  }

  /**
   * Get or create the AST worker
   */
  getAstWorker(): AstWorkerHost {
    if (!this.astWorker) {
      this.astWorker = new AstWorkerHost(this.config);
    }
    return this.astWorker;
  }

  /**
   * Dispose all workers
   */
  dispose(): void {
    this.indexerWorker?.dispose();
    this.astWorker?.dispose();
    this.indexerWorker = undefined;
    this.astWorker = undefined;
  }
}

/**
 * Create a worker pool manager
 */
export function createWorkerPoolManager(
  config?: WorkerConfig
): WorkerPoolManager {
  return new WorkerPoolManager(config);
}

/**
 * AstWorkerHost — dependon infra.
 *
 * Manages the AST Worker Thread lifecycle and provides a Promise-based API
 * for communicating with the worker. Handles worker spawning, message
 * routing, and error handling.
 *
 * Scope (vs analyzer): the 5 signature/breaking-change methods and `reset`
 * are removed (dead code — zero business consumers). Only the 3 analysis
 * methods actually used + `getFileCount` + lifecycle remain.
 *
 * VS Code agnostic — pure Node.js (worker_threads, fs, path).
 *
 * @module dependon/infra
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { getLogger } from '../core/Logger';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';

const log = getLogger('AstWorkerHost');

// Message types matching the AstWorker (signature methods intentionally removed)
type WorkerRequest =
  | { type: 'analyzeFile'; id: number; filePath: string; content: string }
  | { type: 'getInternalExportDeps'; id: number; filePath: string; content: string }
  | { type: 'getFileCount'; id: number };

type WorkerResponse =
  | { type: 'success'; id: number; result: unknown }
  | { type: 'error'; id: number; error: string; stack?: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Analysis result returned by `analyzeFile` */
export interface AnalyzeFileResult {
  symbols: SymbolInfo[];
  dependencies: SymbolDependency[];
}

/**
 * Host for the AST Worker — provides a Promise-based API.
 */
export class AstWorkerHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly workerPath: string;
  private readonly extensionPath?: string;

  /**
   * @param workerPath - Absolute path to the bundled astWorker.js worker script
   * @param extensionPath - Optional package root (for WASM file location)
   */
  constructor(workerPath?: string, extensionPath?: string) {
    this.extensionPath = extensionPath;

    if (workerPath) {
      this.workerPath = workerPath;
    } else {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        // bundled: dist/infra/ → dist/workers/astWorker.cjs
        path.join(currentDir, '..', 'workers', 'astWorker.cjs'),
        // dist/ → dist/workers/astWorker.cjs
        path.join(currentDir, 'workers', 'astWorker.cjs'),
        // src run fallbacks
        path.join(currentDir, '..', '..', 'dist', 'workers', 'astWorker.cjs'),
        path.join(process.cwd(), 'dist', 'workers', 'astWorker.cjs'),
      ];

      let foundPath = '';
      for (const candidatePath of candidates) {
        if (existsSync(candidatePath)) {
          foundPath = candidatePath;
          break;
        }
      }

      this.workerPath = foundPath || path.join(process.cwd(), 'dist', 'workers', 'astWorker.cjs');
    }
  }

  /** Initialize the worker thread */
  public async start(): Promise<void> {
    if (this.worker) {
      log.warn('AstWorker already started');
      return;
    }

    log.info(`Starting AstWorker from ${this.workerPath}`);

    try {
      this.worker = new Worker(this.workerPath, {
        workerData: { extensionPath: this.extensionPath },
      });

      this.worker.on('message', (response: WorkerResponse) => {
        this.handleResponse(response);
      });

      this.worker.on('error', (error: Error) => {
        log.error('AstWorker error:', error);
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error(`AstWorker crashed: ${error.message}`));
        }
        this.pendingRequests.clear();
      });

      this.worker.on('exit', (code: number) => {
        if (code !== 0) {
          log.error(`AstWorker exited with code ${code}`);
        }
        this.worker = null;
      });

      log.info('AstWorker started successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to start AstWorker: ${message}`);
      throw new Error(`Failed to start AstWorker: ${message}`, { cause: error });
    }
  }

  /** Stop the worker thread */
  public async stop(): Promise<void> {
    if (!this.worker) {
      return;
    }

    log.info('Stopping AstWorker');

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('AstWorker stopped'));
    }
    this.pendingRequests.clear();

    await this.worker.terminate();
    this.worker = null;

    log.info('AstWorker stopped');
  }

  /** Analyze a file to extract symbols and dependencies */
  public async analyzeFile(
    filePath: string,
    content: string
  ): Promise<AnalyzeFileResult> {
    const result = await this.sendRequest({
      type: 'analyzeFile',
      id: 0, // will be set by sendRequest
      filePath,
      content,
    });
    return result as AnalyzeFileResult;
  }

  /** Get internal export dependency graph */
  public async getInternalExportDependencyGraph(
    filePath: string,
    content: string
  ): Promise<Map<string, Set<string>>> {
    const result = await this.sendRequest({
      type: 'getInternalExportDeps',
      id: 0,
      filePath,
      content,
    });
    // Convert plain object back to Map<string, Set<string>>
    const obj = result as Record<string, string[]>;
    return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
  }

  /** Get the number of files in the symbol analyzer's memory */
  public async getFileCount(): Promise<number> {
    const result = await this.sendRequest({
      type: 'getFileCount',
      id: 0,
    });
    return result as number;
  }

  /** Send a request to the worker and wait for response */
  private async sendRequest(request: Partial<WorkerRequest> & { type: string }): Promise<unknown> {
    // Auto-start worker on first request
    if (!this.worker) {
      await this.start();
    }

    const id = this.nextId++;
    const fullRequest = { ...request, id } as WorkerRequest;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker?.postMessage(fullRequest);
    });
  }

  /** Handle response from worker */
  private handleResponse(response: WorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      log.warn(`Received response for unknown request ${response.id}`);
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.type === 'success') {
      pending.resolve(response.result);
    } else {
      const error = new Error(response.error);
      if (response.stack) {
        error.stack = response.stack;
      }
      pending.reject(error);
    }
  }
}

/**
 * CallGraphIndexer — sql.js (SQLite WASM) in-memory call-graph store (facade).
 *
 * 编排 DatabaseManager(DB 生命周期)、FileIndexer(索引构建/事务)、EdgeResolver
 * (跨文件边解析)、PersistenceManager(持久化/内存管理)。对外契约(17 个公开
 * 方法 + 类型导出 + getSqlJsWasmPath)不变,callgraph-view-service 零修改。
 *
 * NO vscode imports — this module is VS Code-agnostic.
 *
 * SPEC: specs/001-live-call-graph/data-model.md
 * SCHEMA: specs/001-live-call-graph/contracts/db-schema.sql
 */

import type { Database } from "sql.js";
import type { RelationType, SupportedLang, SymbolType } from "../foundation/callgraph-types";
import { resolveWasmFile } from "../foundation/wasmResolver";
import { DatabaseManager } from "./DatabaseManager";
import { FileIndexer } from "./FileIndexer";
import { EdgeResolver } from "./EdgeResolver";
import { PersistenceManager } from "./PersistenceManager";

// ---------------------------------------------------------------------------
// Input types (used by GraphExtractor / callers)
// ---------------------------------------------------------------------------

export interface CallGraphNode {
  /** Stable ID: normalizedFilePath:symbolName:startLine */
  id: string;
  name: string;
  type: SymbolType;
  lang: SupportedLang;
  /** Normalized absolute path */
  path: string;
  /** Workspace-relative folder (for compound nodes) */
  folder: string;
  startLine: number;
  endLine: number;
  startCol: number;
  isExported: boolean;
}

export interface CallGraphEdge {
  sourceId: string;
  targetId: string;
  typeRelation: RelationType;
  sourceLine: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CallGraphIndexerConfig {
  /**
   * Maximum SQL database size in MB before automatic LRU eviction triggers.
   * Defaults to 256 MB. Set to 0 to disable automatic eviction.
   */
  maxDbSizeMB?: number;
}

// ---------------------------------------------------------------------------
// CallGraphIndexer (facade)
// ---------------------------------------------------------------------------

/**
 * Singleton-per-instance in-memory SQLite graph store.
 * Designed to be created once during extension activation and reused.
 */
export class CallGraphIndexer {
  private readonly dbManager: DatabaseManager;
  private readonly fileIndexer: FileIndexer;
  private readonly edgeResolver: EdgeResolver;
  private readonly persistenceManager: PersistenceManager;

  constructor(wasmPath: string, config?: CallGraphIndexerConfig) {
    this.dbManager = new DatabaseManager(wasmPath);
    this.fileIndexer = new FileIndexer(this.dbManager);
    this.edgeResolver = new EdgeResolver(this.dbManager);
    this.persistenceManager = new PersistenceManager(
      this.dbManager,
      this.fileIndexer,
      config?.maxDbSizeMB,
    );
  }

  // --- DB lifecycle (DatabaseManager) ---

  /** Initialize the sql.js database. Safe to call multiple times. */
  async init(): Promise<void> {
    return this.dbManager.init();
  }

  /** Returns the underlying sql.js Database object. Throws if not initialized. */
  getDb(): Database {
    return this.dbManager.getDb();
  }

  /**
   * Load a database from a file on disk, replacing the current in-memory DB.
   * Returns true on success + schema match; false if missing/corrupt/stale.
   */
  async loadFromFile(filePath: string): Promise<boolean> {
    return this.dbManager.loadFromFile(filePath);
  }

  /** Close the database and release resources. */
  dispose(): void {
    this.dbManager.dispose();
  }

  // --- Indexing / transactions (FileIndexer) ---

  /** Begin an explicit batch transaction (idempotent). */
  beginBatch(): void {
    this.fileIndexer.beginBatch();
  }

  /** Commit the current batch transaction. */
  commitBatch(): void {
    this.fileIndexer.commitBatch();
  }

  /** Roll back the current batch transaction. */
  rollbackBatch(): void {
    this.fileIndexer.rollbackBatch();
  }

  /** Atomically index all nodes and edges for a given source file. */
  indexFile(
    nodes: CallGraphNode[],
    edges: CallGraphEdge[],
    filePath: string,
    lang: SupportedLang,
    mtime: number,
  ): void {
    this.fileIndexer.indexFile(nodes, edges, filePath, lang, mtime);
  }

  /** Remove all nodes and edges associated with the given file path. */
  invalidateFile(filePath: string): void {
    this.fileIndexer.invalidateFile(filePath);
  }

  /** Mark a set of edges as cyclic (is_cyclic = 1). */
  markCycles(edgePairs: Array<{ sourceId: string; targetId: string }>): void {
    this.fileIndexer.markCycles(edgePairs);
  }

  /** Retrieve file_index record if it exists. */
  getFileRecord(filePath: string): { lang: string; lastModified: number; indexedAt: number } | null {
    return this.fileIndexer.getFileRecord(filePath);
  }

  // --- Edge resolution (EdgeResolver) ---

  /** Resolve @@external:<name> stub targets to real indexed node IDs. */
  resolveExternalEdges(): { before: number; resolved: number; deleted: number } {
    return this.edgeResolver.resolveExternalEdges();
  }

  // --- Persistence / memory (PersistenceManager) ---

  /** Export the current database as a binary blob. */
  exportDb(): Uint8Array {
    return this.persistenceManager.exportDb();
  }

  /** Save the current database to a file on disk. */
  async saveToFile(filePath: string): Promise<void> {
    return this.persistenceManager.saveToFile(filePath);
  }

  /** Return the current in-memory SQLite database size in megabytes. */
  getDatabaseSizeMB(): number {
    return this.persistenceManager.getDatabaseSizeMB();
  }

  /** Evict the `n` oldest indexed files. Returns the evicted file paths. */
  evictOldestFiles(n: number): string[] {
    return this.persistenceManager.evictOldestFiles(n);
  }

  /** If the DB exceeds `maxSizeMB`, evict the oldest 10% of indexed files. */
  checkAndEvict(maxSizeMB?: number): void {
    this.persistenceManager.checkAndEvict(maxSizeMB);
  }
}

// ---------------------------------------------------------------------------
// Utility: resolve sql.js WASM path from extension path
// ---------------------------------------------------------------------------

/**
 * Returns the canonical path to sqljs.wasm.
 * extensionPath optional — omitted → wasmResolver auto-locates dist/wasm.
 */
export function getSqlJsWasmPath(extensionPath?: string): string {
  return resolveWasmFile("sqljs.wasm", extensionPath);
}

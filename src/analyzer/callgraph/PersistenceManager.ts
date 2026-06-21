/**
 * PersistenceManager — 调用图数据库的持久化与内存管理。
 *
 * 从 CallGraphIndexer 抽出的"持久化"职责:导出/保存二进制、监控 DB 大小、
 * LRU 驱逐最旧文件。db 经 DatabaseManager 共享;evict 经 FileIndexer 失效
 * 文件(单向依赖,构造注入)。VS Code agnostic。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseManager } from "./DatabaseManager";
import type { FileIndexer } from "./FileIndexer";

export class PersistenceManager {
  private readonly maxDbSizeMB: number;

  constructor(
    private readonly dbManager: DatabaseManager,
    private readonly fileIndexer: FileIndexer,
    maxDbSizeMB?: number,
  ) {
    this.maxDbSizeMB = maxDbSizeMB ?? 256;
  }

  /**
   * Export the current database as a binary blob.
   * Returns a Uint8Array that can be written to disk and later loaded with `loadFromFile()`.
   */
  exportDb(): Uint8Array {
    return this.dbManager.getDb().export();
  }

  /**
   * Save the current database to a file on disk.
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = this.exportDb();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data);
  }

  /**
   * Return the current in-memory SQLite database size in megabytes.
   * Uses SQLite PRAGMAs — no data export needed.
   */
  getDatabaseSizeMB(): number {
    if (!this.dbManager.isInitialized()) return 0;
    const db = this.dbManager.getDb();
    const pageCountRows = db.exec("PRAGMA page_count");
    const pageSizeRows = db.exec("PRAGMA page_size");
    const pageCount = (pageCountRows[0]?.values[0][0] as number) ?? 0;
    const pageSize = (pageSizeRows[0]?.values[0][0] as number) ?? 4096;
    return (pageCount * pageSize) / 1024 / 1024;
  }

  /**
   * Evict the `n` oldest indexed files (by `indexed_at`) from the database.
   * Cascades through nodes and edges via `FileIndexer.invalidateFile()`.
   *
   * @returns Array of evicted file paths.
   */
  evictOldestFiles(n: number): string[] {
    if (n <= 0 || !this.dbManager.isInitialized()) return [];
    const db = this.dbManager.getDb();
    const rows = db.exec(
      `SELECT path FROM file_index ORDER BY indexed_at ASC LIMIT ${n}`,
    );
    const paths = (rows[0]?.values ?? []).map((r) => r[0] as string);
    for (const p of paths) {
      this.fileIndexer.invalidateFile(p);
    }
    return paths;
  }

  /**
   * If the database exceeds `maxSizeMB`, evict the oldest 10 % of indexed
   * files to reclaim space.  Uses `this.maxDbSizeMB` when no argument is given.
   */
  checkAndEvict(maxSizeMB?: number): void {
    const limit = maxSizeMB ?? this.maxDbSizeMB;
    if (limit <= 0) return; // eviction disabled
    if (this.getDatabaseSizeMB() <= limit) return;
    if (!this.dbManager.isInitialized()) return;

    const db = this.dbManager.getDb();
    const countRows = db.exec("SELECT COUNT(*) FROM file_index");
    const total = (countRows[0]?.values[0][0] as number) ?? 0;
    const evictCount = Math.max(1, Math.ceil(total * 0.1));
    this.evictOldestFiles(evictCount);
  }
}

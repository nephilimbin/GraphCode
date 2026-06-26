/**
 * @module dependon/callgraph
 *
 * DatabaseManager — sql.js (SQLite WASM) 内存数据库生命周期管理。
 *
 * 从 CallGraphIndexer 抽出的"DB 生命周期"职责:加载 WASM、建库建表、提供
 * Database 句柄、从文件加载替换当前库、释放资源。VS Code agnostic。
 *
 * SPEC: specs/001-live-call-graph/data-model.md
 * SCHEMA: specs/001-live-call-graph/contracts/db-schema.sql
 */
import fs from "node:fs/promises";
import type { Database, SqlJsStatic } from "sql.js";

// ---------------------------------------------------------------------------
// SQLite schema (inlined — matches contracts/db-schema.sql)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode = MEMORY;
PRAGMA synchronous = OFF;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS file_index (
    path          TEXT     NOT NULL,
    lang          TEXT     NOT NULL,
    last_modified INTEGER  NOT NULL,
    indexed_at    INTEGER  NOT NULL,
    PRIMARY KEY (path)
);

CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT     NOT NULL,
    name        TEXT     NOT NULL,
    type        TEXT     NOT NULL
                         CHECK (type IN ('function','class','method','interface','type','variable')),
    lang        TEXT     NOT NULL,
    path        TEXT     NOT NULL,
    folder      TEXT     NOT NULL,
    start_line  INTEGER  NOT NULL,
    end_line    INTEGER  NOT NULL,
    start_col   INTEGER  NOT NULL,
    is_exported INTEGER  NOT NULL DEFAULT 0,
    indexed_at  INTEGER  NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (path) REFERENCES file_index(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_path   ON nodes(path);
CREATE INDEX IF NOT EXISTS idx_nodes_folder ON nodes(folder);
CREATE INDEX IF NOT EXISTS idx_nodes_type   ON nodes(type);

CREATE TABLE IF NOT EXISTS edges (
    source_id     TEXT     NOT NULL,
    target_id     TEXT     NOT NULL,
    type_relation TEXT     NOT NULL
                           CHECK (type_relation IN ('CALLS','INHERITS','IMPLEMENTS','USES')),
    is_cyclic     INTEGER  NOT NULL DEFAULT 0,
    source_line   INTEGER  NOT NULL,
    indexed_at    INTEGER  NOT NULL,
    PRIMARY KEY (source_id, target_id, type_relation)
    -- FK constraints removed intentionally: @@external: stubs are stored here temporarily
    -- and resolved to real node IDs by resolveExternalEdges() after workspace indexing.
    -- Cascade cleanup is handled manually in indexFile() instead.
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_cyclic ON edges(is_cyclic) WHERE is_cyclic = 1;

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

/** Bump when the schema changes — forces a full rebuild on load. */
const CURRENT_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// DatabaseManager
// ---------------------------------------------------------------------------

export class DatabaseManager {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly wasmPath: string;

  constructor(wasmPath: string) {
    this.wasmPath = wasmPath;
  }

  /**
   * Initialize the sql.js database with the WASM binary and apply the schema.
   * Safe to call multiple times — subsequent calls wait for the first.
   */
  async init(): Promise<void> {
    if (this.db !== null) return;
    if (this.initPromise !== null) return this.initPromise;

    this.initPromise = (async () => {
      const wasmBinary = await fs.readFile(this.wasmPath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const initSqlJs = require("sql.js") as (config: { wasmBinary: Uint8Array }) => Promise<SqlJsStatic>;
      this.SQL = await initSqlJs({ wasmBinary });
      this.db = new this.SQL.Database();
      this.db.run(SCHEMA_SQL);
      this.db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)",
        [String(CURRENT_SCHEMA_VERSION)],
      );
    })();

    return this.initPromise;
  }

  /**
   * Returns the underlying sql.js Database object.
   * Throws if `init()` has not been called.
   */
  getDb(): Database {
    if (!this.db) {
      throw new Error("CallGraphIndexer not initialized — call init() first");
    }
    return this.db;
  }

  /** Whether `init()` has completed and the db handle is available. */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Load a database from a file on disk, replacing the current in-memory DB.
   * Returns `true` if the file was loaded successfully AND the schema version matches.
   * Returns `false` if the file doesn't exist, is corrupted, or has a stale schema version
   * (in which case the caller should fall back to a full re-index with a fresh DB).
   */
  async loadFromFile(filePath: string): Promise<boolean> {
    if (!this.SQL) {
      const wasmBinary = await fs.readFile(this.wasmPath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const initSqlJs = require("sql.js") as (config: { wasmBinary: Uint8Array }) => Promise<SqlJsStatic>;
      this.SQL = await initSqlJs({ wasmBinary });
    }

    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      return false; // file does not exist or is unreadable
    }

    try {
      const loadedDb = new this.SQL.Database(new Uint8Array(data));
      // Verify schema version
      const rows = loadedDb.exec("SELECT value FROM metadata WHERE key = 'schema_version'");
      const storedVersion = rows[0]?.values?.[0]?.[0];
      if (Number(storedVersion) !== CURRENT_SCHEMA_VERSION) {
        loadedDb.close();
        return false; // stale schema → caller should rebuild
      }
      // Replace current DB
      this.db?.close();
      this.db = loadedDb;
      return true;
    } catch {
      return false; // corrupted DB
    }
  }

  /** Close the database and release resources. */
  dispose(): void {
    this.db?.close();
    this.db = null;
    this.SQL = null;
    this.initPromise = null;
  }
}

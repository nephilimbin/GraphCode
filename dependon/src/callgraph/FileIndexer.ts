/**
 * @module dependon/callgraph
 *
 * FileIndexer — 调用图节点/边的索引构建与事务管理。
 *
 * 从 CallGraphIndexer 抽出的"索引构建"职责:原子索引单文件(DELETE+INSERT
 * 事务)、失效文件、标记循环边、查询文件记录。db 经 DatabaseManager 共享。
 * VS Code agnostic。
 *
 * SPEC: specs/001-live-call-graph/data-model.md
 */
import type { SupportedLang } from "../domain/CallGraph";
import type { DatabaseManager } from "./DatabaseManager";
import type { CallGraphEdge, CallGraphNode } from "./CallGraphIndexer";

export class FileIndexer {
  /** True when an explicit batch transaction is active (beginBatch/commitBatch). */
  private inBatch = false;

  constructor(private readonly dbManager: DatabaseManager) {}

  // ---------------------------------------------------------------------------
  // Batch transaction API (multi-file indexing)
  // ---------------------------------------------------------------------------

  /**
   * Begin an explicit batch transaction.
   * While a batch is active, `indexFile()` skips its own BEGIN/COMMIT,
   * reducing per-file transaction overhead when indexing many files.
   */
  beginBatch(): void {
    if (this.inBatch) return; // idempotent
    this.dbManager.getDb().run("BEGIN TRANSACTION");
    this.inBatch = true;
  }

  /**
   * Commit the current batch transaction.
   */
  commitBatch(): void {
    if (!this.inBatch) return;
    this.dbManager.getDb().run("COMMIT");
    this.inBatch = false;
  }

  /**
   * Roll back the current batch transaction.
   */
  rollbackBatch(): void {
    if (!this.inBatch) return;
    this.dbManager.getDb().run("ROLLBACK");
    this.inBatch = false;
  }

  // ---------------------------------------------------------------------------
  // Indexation
  // ---------------------------------------------------------------------------

  /**
   * Atomically index all nodes and edges for a given source file.
   * Existing data for this file is deleted first (DELETE + INSERT in transaction).
   * After insertion the caller should call `markCycles()` with the cyclic edge IDs.
   *
   * @param nodes - Extracted nodes for the file
   * @param edges - Extracted edges for the file
   * @param filePath - Normalized absolute file path
   * @param lang - Language key
   * @param mtime - File mtime at extraction time (Unix ms)
   */
  indexFile(
    nodes: CallGraphNode[],
    edges: CallGraphEdge[],
    filePath: string,
    lang: SupportedLang,
    mtime: number,
  ): void {
    const db = this.dbManager.getDb();
    const now = Date.now();
    const ownTransaction = !this.inBatch;

    if (ownTransaction) db.run("BEGIN TRANSACTION");
    try {
      // Collect old node IDs BEFORE any mutation — needed to clean up dangling
      // incoming edges later. Must happen before file_index upsert because
      // INSERT OR REPLACE triggers FK CASCADE which deletes nodes.
      const oldNodeIds = new Set<string>();
      const oldRows = db.exec("SELECT id FROM nodes WHERE path = ?", [filePath]);
      if (oldRows[0]) {
        for (const r of oldRows[0].values) oldNodeIds.add(r[0] as string);
      }

      // Delete only OUTGOING edges (source is in this file).
      // Incoming edges (from other files targeting nodes in this file) are preserved
      // so that cross-file call relationships survive incremental re-indexation.
      // Must also happen before file_index upsert (FK CASCADE would delete nodes
      // that the subselect references).
      db.run(
        `DELETE FROM edges
         WHERE source_id IN (SELECT id FROM nodes WHERE path = ?)`,
        [filePath],
      );

      // Upsert file_index record.
      // INSERT OR REPLACE triggers FK CASCADE which deletes all nodes for this file.
      db.run(
        `INSERT OR REPLACE INTO file_index (path, lang, last_modified, indexed_at)
         VALUES (?, ?, ?, ?)`,
        [filePath, lang, mtime, now],
      );

      // Insert all nodes (old nodes were cascade-deleted by file_index upsert)
      const nodeStmt = db.prepare(
        `INSERT OR REPLACE INTO nodes
           (id, name, type, lang, path, folder, start_line, end_line, start_col, is_exported, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const n of nodes) {
        nodeStmt.run([
          n.id,
          n.name,
          n.type,
          n.lang,
          n.path,
          n.folder,
          n.startLine,
          n.endLine,
          n.startCol,
          n.isExported ? 1 : 0,
          now,
        ]);
      }
      nodeStmt.free();

      // Insert ALL edges, including @@external: stubs for cross-file calls.
      // @@external: targets are resolved to real node IDs later by resolveExternalEdges().
      const edgeStmt = db.prepare(
        `INSERT OR REPLACE INTO edges
           (source_id, target_id, type_relation, is_cyclic, source_line, indexed_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      );
      for (const e of edges) {
        // Skip edges from an external stub source (should not occur, but defensive)
        if (e.sourceId.startsWith("@@external:")) continue;
        edgeStmt.run([e.sourceId, e.targetId, e.typeRelation, e.sourceLine, now]);
      }
      edgeStmt.free();

      // Clean up dangling incoming edges: if a node was removed or renamed (ID changed),
      // incoming edges targeting its old ID are now orphaned and must be deleted.
      const newNodeIds = new Set(nodes.map((n) => n.id));
      const removedIds = [...oldNodeIds].filter((id) => !newNodeIds.has(id));
      for (const removedId of removedIds) {
        db.run("DELETE FROM edges WHERE target_id = ?", [removedId]);
      }

      if (ownTransaction) db.run("COMMIT");
    } catch (err) {
      if (ownTransaction) db.run("ROLLBACK");
      throw err;
    }
  }

  /**
   * Remove all nodes and edges associated with the given file path.
   * Also removes the file's record from `file_index`.
   * FK CASCADE is not used on edges, so we clean them up manually first.
   *
   * @param filePath - Normalized absolute file path
   */
  invalidateFile(filePath: string): void {
    const db = this.dbManager.getDb();
    // Manually remove edges before nodes (no FK CASCADE on edges table)
    db.run(
      `DELETE FROM edges
       WHERE source_id IN (SELECT id FROM nodes WHERE path = ?)
          OR target_id IN (SELECT id FROM nodes WHERE path = ?)`,
      [filePath, filePath],
    );
    db.run("DELETE FROM file_index WHERE path = ?", [filePath]);
  }

  /**
   * Mark a set of edges as cyclic (is_cyclic = 1).
   * Edges are identified by (source_id, target_id) pairs.
   *
   * @param edgePairs - Array of { sourceId, targetId } pairs to mark
   */
  markCycles(edgePairs: Array<{ sourceId: string; targetId: string }>): void {
    if (edgePairs.length === 0) return;
    const db = this.dbManager.getDb();

    // First reset all is_cyclic flags for these source nodes
    const sourceIds = [...new Set(edgePairs.map((e) => e.sourceId))];
    const placeholders = sourceIds.map(() => "?").join(",");
    db.run(
      `UPDATE edges SET is_cyclic = 0 WHERE source_id IN (${placeholders})`,
      sourceIds,
    );

    // Mark cyclic edges
    const stmt = db.prepare(
      `UPDATE edges SET is_cyclic = 1
       WHERE source_id = ? AND target_id = ?`,
    );
    for (const { sourceId, targetId } of edgePairs) {
      stmt.run([sourceId, targetId]);
    }
    stmt.free();
  }

  /**
   * Retrieve file_index record if it exists.
   * Used to check whether a file is already indexed and if mtime is fresh.
   */
  getFileRecord(filePath: string): { lang: string; lastModified: number; indexedAt: number } | null {
    const db = this.dbManager.getDb();
    const stmt = db.prepare(
      "SELECT lang, last_modified, indexed_at FROM file_index WHERE path = ?",
    );
    stmt.bind([filePath]);
    let result: { lang: string; lastModified: number; indexedAt: number } | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { lang: string; last_modified: number; indexed_at: number };
      result = {
        lang: row.lang,
        lastModified: row.last_modified,
        indexedAt: row.indexed_at,
      };
    }
    stmt.free();
    return result;
  }
}

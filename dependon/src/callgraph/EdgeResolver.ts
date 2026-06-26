/**
 * @module dependon/callgraph
 *
 * EdgeResolver — 解析 @@external: 跨文件存根边为真实节点 ID。
 *
 * 从 CallGraphIndexer 抽出的"边解析"职责:工作区索引完成后调用一次,将
 * @@external:name 存根替换为同语言最佳匹配节点 ID,无法解析的删除。VS Code agnostic。
 */
import type { DatabaseManager } from "./DatabaseManager";

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

type NodeCandidate = { id: string; path: string; isExported: number; indexedAt: number };

/**
 * Count the number of leading directory segments two file paths share.
 * Directories are compared case-sensitively (paths are already normalised).
 * Example: sharedPathSegments('/a/b/c.ts', '/a/b/d.ts') → 2
 */
function sharedPathSegments(pathA: string, pathB: string): number {
  const dirA = pathA.split("/").slice(0, -1);
  const dirB = pathB.split("/").slice(0, -1);
  const len = Math.min(dirA.length, dirB.length);
  let count = 0;
  for (let i = 0; i < len; i++) {
    if (dirA[i] === dirB[i]) { count++; } else { break; }
  }
  return count;
}

/**
 * From a list of candidate nodes, return the one whose path best matches
 * the caller's source path.  Tie-breaking: exported > recently indexed.
 */
function pickBestCandidate(sourcePath: string, candidates: NodeCandidate[]): NodeCandidate {
  let best = candidates[0];
  let bestSim = sharedPathSegments(sourcePath, best.path);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const sim = sharedPathSegments(sourcePath, c.path);
    const betterSim = sim > bestSim;
    const sameSim = sim === bestSim;
    const betterExport = sameSim && c.isExported > best.isExported;
    const betterRecent = sameSim && c.isExported === best.isExported && c.indexedAt > best.indexedAt;
    if (betterSim || betterExport || betterRecent) {
      best = c;
      bestSim = sim;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// EdgeResolver
// ---------------------------------------------------------------------------

export class EdgeResolver {
  constructor(private readonly dbManager: DatabaseManager) {}

  /**
   * Resolve `@@external:<name>` stub targets to real indexed node IDs.
   *
   * After workspace-wide indexing, call this once to replace cross-file stubs
   * with the IDs of the matching nodes in the workspace.  Ambiguous names
   * (same symbol name in multiple files) prefer exported symbols, then most
   * recently indexed.  Stubs that cannot be resolved are deleted.
   *
   * Must be called AFTER all files have been indexed for the result to be correct.
   *
   * Resolution strategy: for each @@external:name stub, find all nodes in the DB
   * that share both the same language AND the same symbol name, then pick the one
   * whose file path shares the most leading path segments with the caller's file.
   * Ties are broken by preferring exported symbols and then most-recently indexed
   * files.  Restricting to same-language candidates prevents cross-language
   * false matches (e.g. a Java `User` binding to a Go `User` struct).
   */
  resolveExternalEdges(): { before: number; resolved: number; deleted: number } {
    const db = this.dbManager.getDb();

    // Count stubs before resolution.
    const beforeRows = db.exec("SELECT COUNT(*) FROM edges WHERE target_id LIKE '@@external:%'");
    const before = (beforeRows[0]?.values[0][0] as number | null) ?? 0;

    if (before === 0) {
      return { before: 0, resolved: 0, deleted: 0 };
    }

    // Fetch all external stub edges together with the source node's file path and lang.
    // Joining nodes gives us the source file path + lang without parsing the composite ID.
    const stubRows = db.exec(`
      SELECT e.rowid, s.path AS source_path, s.lang AS source_lang, SUBSTR(e.target_id, 12) AS sym_name
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      WHERE e.target_id LIKE '@@external:%'
    `);

    // Fetch all candidate target nodes that could satisfy any stub.
    // Include lang so we can restrict resolution to same-language candidates only.
    const candidateRows = db.exec(`
      SELECT name, id, path, is_exported, indexed_at, lang
      FROM nodes
      WHERE name IN (
        SELECT DISTINCT SUBSTR(target_id, 12) FROM edges WHERE target_id LIKE '@@external:%'
      )
    `);

    // Build (lang + "\0" + name) → candidates map so lookups are language-scoped.
    const candidateMap = new Map<string, Array<{ id: string; path: string; isExported: number; indexedAt: number }>>();
    if (candidateRows[0]) {
      for (const row of candidateRows[0].values as [string, string, string, number, number, string][]) {
        const [name, id, nodePath, isExported, indexedAt, lang] = row;
        const key = `${lang}\0${name}`;
        const existing = candidateMap.get(key);
        if (existing) {
          existing.push({ id, path: nodePath, isExported, indexedAt });
        } else {
          candidateMap.set(key, [{ id, path: nodePath, isExported, indexedAt }]);
        }
      }
    }

    // Apply best-match updates: for each stub, pick the same-language candidate
    // whose file shares the most leading path segments with the caller's file.
    const updateStmt = db.prepare("UPDATE OR IGNORE edges SET target_id = ? WHERE rowid = ?");
    let resolved = 0;
    if (stubRows[0]) {
      for (const row of stubRows[0].values as [number, string, string, string][]) {
        const [rowid, sourcePath, sourceLang, symName] = row;
        const candidates = candidateMap.get(`${sourceLang}\0${symName}`);
        if (!candidates || candidates.length === 0) { continue; }
        const best = pickBestCandidate(sourcePath, candidates);
        updateStmt.run([best.id, rowid]);
        resolved++;
      }
    }
    updateStmt.free();

    // Remove remaining unresolved stubs (library calls, builtins, etc.)
    db.run("DELETE FROM edges WHERE target_id LIKE '@@external:%'");
    // Defensive: remove any orphaned external sources.
    db.run("DELETE FROM edges WHERE source_id LIKE '@@external:%'");

    const deleted = before - resolved;
    return { before, resolved, deleted };
  }
}

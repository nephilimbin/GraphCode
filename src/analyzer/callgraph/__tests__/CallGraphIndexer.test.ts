// @vitest-environment node
/**
 * CallGraphIndexer sql.js 集成测试(回归网)。
 *
 * CallGraphIndexer 原无测试。本测试在拆分(抽取 DatabaseManager / FileIndexer /
 * EdgeResolver / PersistenceManager)前建立回归网,断言关键行为;拆分后跑同套
 * 用例验证"行为零变化"。
 *
 * 断言避开绝对时间戳(indexedAt = Date.now()),聚焦存在性 / 计数 / 布尔 / 路径。
 * 依赖 dist/sqljs.wasm(经 getSqlJsWasmPath 定位),由 beforeEach init 加载。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CallGraphIndexer, getSqlJsWasmPath } from "../CallGraphIndexer";
import type { CallGraphEdge, CallGraphNode } from "../CallGraphIndexer";

const makeNode = (
  over: Partial<CallGraphNode> & { id: string; name: string },
): CallGraphNode => ({
  id: over.id,
  name: over.name,
  type: over.type ?? "function",
  lang: over.lang ?? "typescript",
  path: over.path ?? "/test/file.ts",
  folder: over.folder ?? "test",
  startLine: over.startLine ?? 1,
  endLine: over.endLine ?? 10,
  startCol: over.startCol ?? 0,
  isExported: over.isExported ?? false,
  ...over,
});

const makeEdge = (
  over: { sourceId: string; targetId: string; typeRelation?: CallGraphEdge["typeRelation"]; sourceLine?: number },
): CallGraphEdge => ({
  sourceId: over.sourceId,
  targetId: over.targetId,
  typeRelation: over.typeRelation ?? "CALLS",
  sourceLine: over.sourceLine ?? 1,
});

describe("CallGraphIndexer", () => {
  let indexer: CallGraphIndexer;

  beforeEach(async () => {
    indexer = new CallGraphIndexer(getSqlJsWasmPath());
    await indexer.init();
  });

  afterEach(() => indexer.dispose());

  /** 查询标量(第一行第一列)。 */
  const scalar = (sql: string): unknown => indexer.getDb().exec(sql)[0]?.values[0][0];

  describe("初始化", () => {
    it("init 幂等;getDb 未 init 抛错", async () => {
      const fresh = new CallGraphIndexer(getSqlJsWasmPath());
      expect(() => fresh.getDb()).toThrow();
      await fresh.init();
      await fresh.init(); // 幂等,不报错
      expect(fresh.getDb()).toBeDefined();
      fresh.dispose();
    });
  });

  describe("indexFile / getFileRecord", () => {
    it("索引后 file_index 有记录", () => {
      const filePath = "/test/foo.ts";
      indexer.indexFile(
        [makeNode({ id: "foo:bar:1", name: "bar", path: filePath })],
        [],
        filePath,
        "typescript",
        1000,
      );
      const rec = indexer.getFileRecord(filePath);
      expect(rec).not.toBeNull();
      expect(rec!.lang).toBe("typescript");
      expect(rec!.lastModified).toBe(1000);
    });

    it("重新索引替换旧节点(增量)", () => {
      const filePath = "/test/foo.ts";
      indexer.indexFile(
        [
          makeNode({ id: "foo:a:1", name: "a", path: filePath }),
          makeNode({ id: "foo:b:1", name: "b", path: filePath }),
        ],
        [],
        filePath,
        "typescript",
        1000,
      );
      expect(scalar("SELECT COUNT(*) FROM nodes")).toBe(2);
      // 重新索引只保留 a
      indexer.indexFile(
        [makeNode({ id: "foo:a:1", name: "a", path: filePath })],
        [],
        filePath,
        "typescript",
        2000,
      );
      expect(scalar("SELECT COUNT(*) FROM nodes")).toBe(1);
    });
  });

  describe("invalidateFile", () => {
    it("invalidate 删除文件记录与节点", () => {
      const filePath = "/test/foo.ts";
      indexer.indexFile(
        [makeNode({ id: "foo:bar:1", name: "bar", path: filePath })],
        [],
        filePath,
        "typescript",
        1000,
      );
      expect(scalar("SELECT COUNT(*) FROM nodes")).toBe(1);
      indexer.invalidateFile(filePath);
      expect(indexer.getFileRecord(filePath)).toBeNull();
      expect(scalar("SELECT COUNT(*) FROM nodes")).toBe(0);
    });
  });

  describe("markCycles", () => {
    it("标记指定边为 cyclic", () => {
      const filePath = "/test/foo.ts";
      indexer.indexFile(
        [
          makeNode({ id: "a", name: "a", path: filePath }),
          makeNode({ id: "b", name: "b", path: filePath }),
        ],
        [makeEdge({ sourceId: "a", targetId: "b" })],
        filePath,
        "typescript",
        1000,
      );
      indexer.markCycles([{ sourceId: "a", targetId: "b" }]);
      expect(
        scalar("SELECT is_cyclic FROM edges WHERE source_id='a' AND target_id='b'"),
      ).toBe(1);
    });
  });

  describe("resolveExternalEdges", () => {
    it("将 @@external: 存根解析为同语言候选节点", () => {
      indexer.indexFile(
        [makeNode({ id: "f1:bar", name: "bar", path: "/test/f1.ts", isExported: true })],
        [],
        "/test/f1.ts",
        "typescript",
        1000,
      );
      indexer.indexFile(
        [makeNode({ id: "f2:foo", name: "foo", path: "/test/f2.ts" })],
        [makeEdge({ sourceId: "f2:foo", targetId: "@@external:bar" })],
        "/test/f2.ts",
        "typescript",
        2000,
      );
      const result = indexer.resolveExternalEdges();
      expect(result.before).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.deleted).toBe(0);
      expect(scalar("SELECT target_id FROM edges WHERE source_id='f2:foo'")).toBe("f1:bar");
    });

    it("无候选时 stub 被删除", () => {
      indexer.indexFile(
        [makeNode({ id: "f2:foo", name: "foo", path: "/test/f2.ts" })],
        [makeEdge({ sourceId: "f2:foo", targetId: "@@external:missing" })],
        "/test/f2.ts",
        "typescript",
        2000,
      );
      const result = indexer.resolveExternalEdges();
      expect(result.before).toBe(1);
      expect(result.resolved).toBe(0);
      expect(result.deleted).toBe(1);
      expect(
        scalar("SELECT COUNT(*) FROM edges WHERE target_id LIKE '@@external:%'"),
      ).toBe(0);
    });
  });

  describe("exportDb / loadFromFile", () => {
    it("导出二进制并能加载回;不存在文件返回 false", async () => {
      const filePath = "/test/foo.ts";
      indexer.indexFile(
        [makeNode({ id: "foo:bar:1", name: "bar", path: filePath })],
        [],
        filePath,
        "typescript",
        1000,
      );
      const data = indexer.exportDb();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBeGreaterThan(0);

      const tmpFile = path.join(os.tmpdir(), `cgtest-${Date.now()}.db`);
      try {
        await indexer.saveToFile(tmpFile);
        const ok = await indexer.loadFromFile(tmpFile);
        expect(ok).toBe(true);
        expect(indexer.getFileRecord(filePath)).not.toBeNull();
      } finally {
        fs.unlinkSync(tmpFile);
      }

      expect(await indexer.loadFromFile("/nonexistent/path.db")).toBe(false);
    });
  });

  describe("evictOldestFiles", () => {
    it("驱逐最旧文件并返回路径", () => {
      indexer.indexFile(
        [makeNode({ id: "f1:a", name: "a", path: "/t/f1.ts" })],
        [],
        "/t/f1.ts",
        "typescript",
        1000,
      );
      const evicted = indexer.evictOldestFiles(1);
      expect(evicted).toHaveLength(1);
      expect(evicted[0]).toBe("/t/f1.ts");
      expect(indexer.getFileRecord("/t/f1.ts")).toBeNull();
    });
  });
});

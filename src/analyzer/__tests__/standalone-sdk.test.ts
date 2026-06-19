/**
 * 独立 SDK 门面冒烟测试(ADR 003 §1b)
 *
 * 验证分析核心作为独立 SDK 的关键契约 —— 无需 VS Code 插件即可被构造与使用:
 *   1. 对外 API 从 index.ts 门面可正常导入(编译 + 运行时均确认存在)。
 *   2. SpiderBuilder 零配置可用:extensionPath 可选,build() 仅要求 rootDir。
 *   3. wasmResolver 资源定位:显式 extensionPath 与可选参数兜底各按预期拼装路径。
 *
 * 不实际加载 tree-sitter WASM(那是 integration 层,在 CI 环境不稳定)。
 * 这里只验证「SDK 可被独立构造 + 资源可被定位」的契约。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  Spider,
  SpiderBuilder,
  CallGraphIndexer,
  getSqlJsWasmPath,
  queryNeighbourhood,
  GraphExtractor,
  detectCycleEdges,
  SourceFileCollector,
  resolveResourcesDir,
  resolveWasmFile,
  resolveQueryFile,
} from "../index";

describe("analyzer 独立 SDK 门面 (ADR 003 §1b)", () => {
  it("门面导出 ADR §3.3 全部核心符号", () => {
    expect(Spider).toBeDefined();
    expect(SpiderBuilder).toBeDefined();
    expect(CallGraphIndexer).toBeDefined();
    expect(typeof getSqlJsWasmPath).toBe("function");
    expect(typeof queryNeighbourhood).toBe("function");
    expect(GraphExtractor).toBeDefined();
    expect(typeof detectCycleEdges).toBe("function");
    expect(SourceFileCollector).toBeDefined();
  });

  it("SpiderBuilder 零配置可构造(extensionPath 可选,仅需 rootDir)", () => {
    // 不传 extensionPath —— 证明 SDK 无需任何插件路径即可实例化。
    // build() 同步构造 Spider,惰性加载 WASM,不会在此触发索引或资源读取。
    const spider = new SpiderBuilder().withRootDir(__dirname).build();
    expect(spider).toBeInstanceOf(Spider);
  });

  it("getSqlJsWasmPath 零参数不抛错并定位到 sqljs.wasm", () => {
    expect(() => getSqlJsWasmPath()).not.toThrow();
    expect(getSqlJsWasmPath()).toContain("sqljs.wasm");
  });

  it("resolveResourcesDir 显式 extensionPath 拼接到 dist/", () => {
    expect(resolveResourcesDir("/fake/ext")).toBe(path.join("/fake/ext", "dist"));
  });

  it("resolveWasmFile / resolveQueryFile 零参数与显式参数均按预期拼装", () => {
    // 显式 extensionPath
    expect(resolveWasmFile("tree-sitter.wasm", "/fake/ext")).toBe(
      path.join("/fake/ext", "dist", "wasm", "tree-sitter.wasm"),
    );
    expect(resolveQueryFile("python.scm", "/fake/ext")).toBe(
      path.join("/fake/ext", "dist", "queries", "python.scm"),
    );
    // 零参数(兜底路径不抛错,且落到 wasm/ 子目录)
    expect(() => resolveWasmFile("tree-sitter.wasm")).not.toThrow();
    expect(resolveWasmFile("tree-sitter.wasm")).toContain("wasm");
  });
});

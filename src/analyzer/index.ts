/**
 * GraphCode Analyzer — 对外公共 API 注册表(ADR 003 §1b / §3.3)
 *
 * 这是分析核心的对外门面。所有外部集成方应只从此处导入,而非深潜内部模块;
 * 内部模块路径不被视为稳定 API,可随重构调整。
 *
 * 分析核心完全独立于 VS Code 插件(零 foundation/shared 依赖),可作为
 * 独立 SDK 被其他工具集成。详见
 * docs/adr/003-standalone-analyzer-core-and-iterative-refactor.md
 *
 * WASM 资源:所有 `extensionPath` 参数均**可选**。集成方零配置即可使用 ——
 * wasmResolver 基于 `__dirname` 自动定位 `dist/wasm` & `dist/queries`;
 * 仅当资源位于非默认布局时才需显式传入 extensionPath。
 */

// ---------------------------------------------------------------------------
// ADR §3.3 核心契约(10 个符号)
// ---------------------------------------------------------------------------

// 引擎主门面
export { Spider } from "./core/Spider";
export type { SpiderServices } from "./core/SpiderServices";
export { SpiderBuilder } from "./core/SpiderBuilder";

// 调用图
export { CallGraphIndexer } from "./callgraph/CallGraphIndexer";
export { getSqlJsWasmPath } from "./callgraph/CallGraphIndexer";
export { queryNeighbourhood } from "./callgraph/CallGraphQuery";
export type { NeighbourhoodResult } from "./callgraph/CallGraphQuery";
export { GraphExtractor } from "./callgraph/GraphExtractor";
export type { ExtractorConfig, ExtractionResult } from "./callgraph/GraphExtractor";
export { detectCycleEdges } from "./callgraph/cycleUtils";

// 收集与分析器
export { SourceFileCollector } from "./source/SourceFileCollector";
export { LspCallHierarchyAnalyzer } from "./lsp/LspCallHierarchyAnalyzer";

// 索引状态(类型)
export type {
  IndexerState,
  IndexerStatusSnapshot,
  IndexerStatusCallback,
} from "./indexing/IndexerStatus";

// ---------------------------------------------------------------------------
// 公共类型层
// ---------------------------------------------------------------------------

// analyzer 自有的 symbol / dependency / index 类型(含 SymbolNode / CallEdge 等)
export * from "./foundation/types";

// 调用图枚举与序列化类型(具名导出,避免与 types.ts 的 Serialized* 重名)
export type {
  SymbolType,
  RelationType,
  SupportedLang,
  SerializedCallNode,
  SerializedCallEdge,
  SerializedCompoundNode,
} from "./foundation/callgraphTypes";

// ---------------------------------------------------------------------------
// SDK 集成辅助(超出 ADR §3.3 核心契约,供集成方诊断 / 自定义资源定位)
// ---------------------------------------------------------------------------

export {
  resolveResourcesDir,
  resolveWasmFile,
  resolveQueryFile,
} from "./foundation/wasmResolver";

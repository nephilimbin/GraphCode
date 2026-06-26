/**
 * dependon — public API registry.
 *
 * External integrators should import only from here; internal module paths are
 * not stable and may change. dependon is a standalone, VS Code-agnostic code
 * analysis library.
 *
 * @module dependon
 */

// Engine facade
export { Analyzer } from '../facade/Analyzer';
export { AnalyzerBuilder } from '../facade/AnalyzerBuilder';
export type { AnalyzerServices } from '../facade/AnalyzerBuilder';

// Call graph subsystem (independent of the Analyzer facade)
export { CallGraphIndexer } from '../callgraph/CallGraphIndexer';
export { getSqlJsWasmPath } from '../callgraph/CallGraphIndexer';
export { queryNeighbourhood } from '../callgraph/CallGraphQuery';
export type { NeighbourhoodResult } from '../callgraph/CallGraphQuery';
export { GraphExtractor } from '../callgraph/GraphExtractor';
export type { ExtractorConfig, ExtractionResult } from '../callgraph/GraphExtractor';
export { detectCycleEdges } from '../callgraph/CycleUtils';

// LSP boundary adapter
export { LspCallHierarchyAnalyzer } from '../lsp/LspCallHierarchyAnalyzer';

// Source collection
export { SourceFileCollector } from '../resolution/SourceFileCollector';

// Index status types
export type {
  IndexerState,
  IndexerStatusSnapshot,
  IndexerStatusCallback,
} from '../indexing/IndexerStatus';

// SDK resource-locator helpers
export {
  resolveResourcesDir,
  resolveWasmFile,
  resolveQueryFile,
} from '../core/WasmResolver';

// ---------------------------------------------------------------------------
// Public type layer
// ---------------------------------------------------------------------------

export type {
  Dependency,
  DependencyType,
  ParsedImport,
  ReverseIndexEntry,
  FileHash,
  IndexingProgressCallback,
  SerializedReverseIndex,
} from '../domain/Dependency';

export type {
  SymbolInfo,
  SymbolDependency,
  ILanguageAnalyzer,
  ISymbolAnalyzer,
} from '../domain/Symbol';

export type {
  SymbolNode,
  CallEdge,
  CycleType,
  IntraFileGraph,
} from '../domain/SymbolGraph';

export type {
  SymbolType,
  RelationType,
  SupportedLang,
  SerializedCallNode,
  SerializedCallEdge,
  SerializedCompoundNode,
} from '../domain/CallGraph';

export type { AnalyzerConfig } from '../domain/Config';

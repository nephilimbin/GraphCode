/**
 * Analyzer Call-Graph Types
 *
 * Self-contained call-graph types owned by the analysis core (mirrors the
 * data-model subset of src/shared/callgraph-types.ts). Contains the primitive
 * types and serialized payloads the analyzer emits; the webview message
 * protocol types (ShowCallGraphMessage etc.) are intentionally NOT duplicated.
 */

/** Symbol types recognized by the GraphExtractor */
export type SymbolType =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "variable";

/** Relation types extracted by Tree-sitter queries */
export type RelationType = "CALLS" | "INHERITS" | "IMPLEMENTS" | "USES";

/** Languages supported by the call-graph extractor (includes swift) */
export type SupportedLang = "typescript" | "javascript" | "python" | "rust" | "csharp" | "go" | "java" | "swift";

export interface SerializedCallNode {
  /** Stable ID: normalizedFilePath:symbolName:startLine */
  id: string;
  /** Symbol's bare display name */
  name: string;
  type: SymbolType;
  lang: SupportedLang;
  /** Normalized absolute path */
  path: string;
  /** Workspace-relative folder path (determines compound node parent) */
  folder: string;
  /** 0-based start line */
  startLine: number;
  /** 0-based end line */
  endLine: number;
  /** 0-based start column */
  startCol: number;
  isExported: boolean;
  /** True when this node is the symbol the user triggered the graph from */
  isRoot: boolean;
}

export interface SerializedCallEdge {
  sourceId: string;
  targetId: string;
  typeRelation: RelationType;
  /** True when this edge is part of a detected cycle */
  isCyclic: boolean;
  /** Line in source file where the reference occurs */
  sourceLine: number;
  /** Direction relative to the query root node */
  direction: "outgoing" | "incoming" | "lateral";
}

export interface SerializedCompoundNode {
  /** Workspace-relative folder path (folder) or absolute file path (file) */
  id: string;
  /** Display label, e.g. "services" or "utils.ts" */
  label: string;
  type: "compound";
  /** Two-level hierarchy: top-level folder groups contain file groups */
  compoundLevel: "folder" | "file";
  /** For file-level compounds: the parent folder compound id */
  parent?: string;
}

/**
 * Call-graph serialized payload types.
 *
 * Self-contained types owned by the call-graph subsystem; mirror the
 * data-model subset of the host project's shared call-graph types.
 *
 * @module dependon/domain
 */

/** Symbol types recognized by the call-graph extractor */
export type SymbolType =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "variable";

/** Relation types extracted by Tree-sitter queries */
export type RelationType = "CALLS" | "INHERITS" | "IMPLEMENTS" | "USES";

/** Languages supported by the call-graph extractor */
export type SupportedLang =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "csharp"
  | "go"
  | "java"
  | "swift";

/** Serialized call-graph node (stable ID: normalizedFilePath:symbolName:startLine) */
export interface SerializedCallNode {
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

/** Serialized call-graph edge */
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

/** Serialized compound node (folder/file grouping) */
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

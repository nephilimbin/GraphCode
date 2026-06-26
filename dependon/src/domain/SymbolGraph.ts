/**
 * Intra-file symbol graph types.
 *
 * NOTE: {@link SymbolNode} is intentionally distinct from the
 * {@link SymbolInfo} in `./Symbol` — they carry different fields and serve
 * different consumers (AST drill-down vs symbol dependency tracking).
 *
 * @module dependon/domain
 */

/** Intra-file symbol node (AST/LSP-level) */
export interface SymbolNode {
  id: string;
  name: string;
  originalName?: string;
  kind: number;
  type: "class" | "function" | "variable";
  range: { start: number; end: number };
  isExported: boolean;
  isExternal: boolean;
  parentSymbolId?: string;
}

/** A call/reference edge between two symbol nodes */
export interface CallEdge {
  source: string;
  target: string;
  relation: "calls" | "references";
  direction?: "outgoing" | "incoming";
  line: number;
}

export type CycleType = "self-recursive" | "mutual-recursive" | "complex";

/** Intra-file call graph (LSP-derived or AST-derived) */
export interface IntraFileGraph {
  filePath: string;
  nodes: SymbolNode[];
  edges: CallEdge[];
  incomingEdges?: CallEdge[];
  hasCycle: boolean;
  cycleNodes?: string[];
  cycleType?: CycleType;
}

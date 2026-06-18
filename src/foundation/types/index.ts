/**
 * Barrel re-export for backward compatibility.
 *
 * Import from domain files directly for reduced blast radius:
 * - core-types.ts     → Result, Option, ok, err, some, none, etc.
 * - graph-types.ts    → GraphEdge, GraphData
 * - symbol-types.ts   → SymbolNode, CallEdge, IntraFileGraph, ...
 * - callgraph-types.ts → Live Call Graph types
 */

// Core utility types
export * from './core-types';

// Domain-specific types
export * from './callgraph-types';
export * from './graph-types';
export * from './symbol-types';

/**
 * File-level dependency types.
 *
 * @module dependon/domain
 */

/** Type of import/dependency statement */
export type DependencyType = "import" | "require" | "export" | "dynamic";

/** A resolved dependency from a source file */
export interface Dependency {
  path: string;
  type: DependencyType;
  line: number;
  module: string; // Original module specifier
}

/** A parsed import statement before path resolution */
export interface ParsedImport {
  module: string;
  type: DependencyType;
  line: number;
}

/** Entry in the reverse index mapping a target file to its referencing files */
export interface ReverseIndexEntry {
  /** The source file that imports the target */
  sourcePath: string;
  /** Type of import */
  type: DependencyType;
  /** Line number of the import statement */
  line: number;
  /** Original module specifier */
  module: string;
}

/** File hash for staleness detection (uses mtime + size for performance) */
export interface FileHash {
  /** File modification time in milliseconds */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/** Progress callback for indexing operations */
export type IndexingProgressCallback = (
  processed: number,
  total: number,
  currentFile?: string,
) => void;

/** Serializable format for persisting the reverse index */
export interface SerializedReverseIndex {
  version: number;
  timestamp: number;
  rootDir: string;
  /** Map of target path -> array of referencing entries */
  reverseMap: Record<string, ReverseIndexEntry[]>;
  /** Map of file path -> file hash */
  fileHashes: Record<string, FileHash>;
}

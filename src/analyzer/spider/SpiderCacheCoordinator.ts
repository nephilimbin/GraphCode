import { Cache } from '../Cache';
import type { Dependency, SymbolDependency, SymbolInfo } from '../foundation/types';
import { normalizePath } from '../foundation/types';
import { ReverseIndexManager } from '../ReverseIndexManager';

type SymbolGraph = { symbols: SymbolInfo[]; dependencies: SymbolDependency[] };

/**
 * Keeps dependency cache, symbol cache, and reverse index consistent.
 * Single responsibility: cache/index coherence when files change.
 */
export class SpiderCacheCoordinator {
  constructor(
    private readonly dependencyCache: Cache<Dependency[]>,
    private readonly symbolCache: Cache<SymbolGraph>,
    private readonly reverseIndexManager: ReverseIndexManager
  ) {}

  clearAll(): void {
    this.dependencyCache.clear();
    this.symbolCache.clear();
    this.reverseIndexManager.clear();
  }

  invalidateFile(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    const wasInCache = this.dependencyCache.has(normalized);

    this.dependencyCache.delete(normalized);
    this.symbolCache.delete(normalized);
    this.reverseIndexManager.removeDependenciesFromSource(normalized);

    return wasInCache;
  }

  invalidateFiles(filePaths: string[]): number {
    let invalidatedCount = 0;
    for (const filePath of filePaths) {
      if (this.invalidateFile(filePath)) {
        invalidatedCount++;
      }
    }
    return invalidatedCount;
  }

  handleFileDeleted(filePath: string): void {
    const normalized = normalizePath(filePath);

    // Invalidate the deleted file itself (its own outgoing edges + symbol graph).
    this.dependencyCache.delete(normalized);
    this.symbolCache.delete(normalized);
    this.reverseIndexManager.removeDependenciesFromSource(normalized);

    // Invalidate every file that referenced the deleted one. Each such file's
    // dependencyCache still holds a stale `Y -> X` edge; without this, the next
    // crawl() reads it from cache and the deleted node reappears.
    //
    // We scan dependencyCache directly (it IS the source of truth for the
    // graph) rather than the reverse index: the reverse index may be disabled
    // or not yet populated for this target, in which case getReferencingFiles
    // returns [] and referencing caches would never be invalidated.
    //
    // On the next crawl, analyze(Y) cache-misses and re-resolves from disk:
    // the resolver checks file existence, so the now-deleted target resolves to
    // null and the stale `Y -> X` edge is dropped. The reverse index self-
    // corrects when analyze(Y) rewrites Y's edges (overwrite semantics).
    for (const [sourcePath, dependencies] of this.dependencyCache.entries()) {
      if (dependencies.some((dep) => dep.path === normalized)) {
        this.dependencyCache.delete(sourcePath);
      }
    }
  }
}


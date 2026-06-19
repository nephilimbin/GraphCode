/**
 * Unit tests for SpiderCacheCoordinator.
 *
 * The intent these encode: when a file X is deleted, every file Y whose
 * dependencyCache still holds a stale `Y -> X` edge must be invalidated.
 * Otherwise the next crawl() reads the stale edge from cache and the deleted
 * node reappears in the graph. This is the source-of-truth scan over
 * dependencyCache, so it must hold even when the reverse index is disabled
 * (the production default), where getReferencingFiles returns [].
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Cache } from '../../Cache';
import { ReverseIndexManager } from '../../ReverseIndexManager';
import { SpiderCacheCoordinator } from '../SpiderCacheCoordinator';
import type { Dependency, DependencyType } from '../../foundation/types';

type SymbolGraph = { symbols: unknown[]; dependencies: unknown[] };

const EMPTY_SYMBOL_GRAPH: SymbolGraph = { symbols: [], dependencies: [] };

function dep(path: string): Dependency {
  return { path, type: 'import' as DependencyType, line: 1, module: path };
}

describe('SpiderCacheCoordinator.handleFileDeleted', () => {
  let dependencyCache: Cache<Dependency[]>;
  let symbolCache: Cache<SymbolGraph>;
  let coordinator: SpiderCacheCoordinator;

  beforeEach(() => {
    dependencyCache = new Cache<Dependency[]>();
    symbolCache = new Cache<SymbolGraph>();
    // Reverse index deliberately NOT enabled — mirrors the production default
    // (SpiderConfig.enableReverseIndex is false). In this state
    // getReferencingFiles returns [], so only a direct dependencyCache scan can
    // find referencers. This is the exact scenario that regressed before.
    const reverseIndexManager = new ReverseIndexManager('/root');
    coordinator = new SpiderCacheCoordinator(
      dependencyCache,
      symbolCache,
      reverseIndexManager
    );
  });

  it('invalidates the dependencyCache of files that referenced the deleted file', () => {
    // a.ts imports x.ts; b.ts imports y.ts (not x.ts).
    dependencyCache.set('/root/a.ts', [dep('/root/x.ts')]);
    dependencyCache.set('/root/b.ts', [dep('/root/y.ts')]);
    dependencyCache.set('/root/x.ts', []);

    coordinator.handleFileDeleted('/root/x.ts');

    // a.ts referenced x.ts -> must be re-analyzed, so its cache is invalidated.
    expect(dependencyCache.has('/root/a.ts')).toBe(false);
    // b.ts is unaffected: it never referenced x.ts.
    expect(dependencyCache.has('/root/b.ts')).toBe(true);
  });

  it('removes the deleted file itself from both caches', () => {
    dependencyCache.set('/root/x.ts', [dep('/root/z.ts')]);
    symbolCache.set('/root/x.ts', EMPTY_SYMBOL_GRAPH);

    coordinator.handleFileDeleted('/root/x.ts');

    expect(dependencyCache.has('/root/x.ts')).toBe(false);
    expect(symbolCache.has('/root/x.ts')).toBe(false);
  });

  it('leaves the graph correct when the deleted file is orphan (no referencers)', () => {
    dependencyCache.set('/root/x.ts', [dep('/root/z.ts')]);
    dependencyCache.set('/root/z.ts', []);

    coordinator.handleFileDeleted('/root/x.ts');

    expect(dependencyCache.has('/root/x.ts')).toBe(false);
    // z.ts was only a dependency target of x, not a referencer of x -> untouched.
    expect(dependencyCache.has('/root/z.ts')).toBe(true);
  });
});

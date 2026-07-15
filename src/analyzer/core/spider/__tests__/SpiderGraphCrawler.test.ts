/**
 * Unit tests for SpiderGraphCrawler's self-loop edge filtering.
 *
 * Intent encoded here: when a file imports something that resolves back to
 * itself (e.g. `import pty` inside pty.py, where the bare name resolves to the
 * same-named file), the resolver yields a self-edge A→A. Such an edge is
 * resolution noise, NOT a cross-file cycle — yet detectCycles treats any
 * self-edge as a length-1 cycle, which is exactly how pty.py got falsely
 * flagged as "Circular dependency". The crawler must drop self-edges at build
 * time. Genuine cycles are A→B→A (>=2 nodes) and MUST remain detected, so this
 * guard must never swallow a real cycle.
 */
import { describe, it, expect } from 'vitest';
import { SpiderGraphCrawler } from '../SpiderGraphCrawler';
import type { SpiderDependencyAnalyzer } from '../SpiderDependencyAnalyzer';
import type { Dependency, DependencyType, SpiderConfig } from '../../../foundation/types';
import { detectCycles } from '../../../callgraph/cycleUtils';

function dep(path: string, module: string = path): Dependency {
  return { path, type: 'import' as DependencyType, line: 1, module };
}

/** Minimal stand-in for SpiderDependencyAnalyzer: analyze() returns canned deps. */
function fakeAnalyzer(map: Record<string, Dependency[]>): SpiderDependencyAnalyzer {
  return {
    analyze: (fp: string) => Promise.resolve(map[fp] ?? []),
  } as unknown as SpiderDependencyAnalyzer;
}

const A = '/proj/pty.py';
const B = '/proj/defs.py';
const noConfig = () => ({}) as SpiderConfig;

describe('SpiderGraphCrawler self-loop filtering', () => {
  it('drops a dependency resolving back to the importing file, so it is not a cycle', async () => {
    // pty.py resolves bare `import pty` to itself (self-loop) AND legitimately
    // depends on defs.py. Only the self-edge must disappear.
    const analyzer = fakeAnalyzer({
      [A]: [dep(A, 'pty'), dep(B, 'defs')],
      [B]: [],
    });
    const crawler = new SpiderGraphCrawler(analyzer, noConfig);

    const { nodes, edges } = await crawler.crawl(A);

    expect(edges.some((e) => e.source === e.target)).toBe(false);
    expect(edges).toContainEqual({ source: A, target: B });
    expect(detectCycles(edges).size).toBe(0);
    expect(nodes).toContain(A);
    expect(nodes).toContain(B);
  });

  it('still detects a genuine cross-file cycle (regression guard)', async () => {
    // A↔B is a real 2-node cycle and must NOT be hidden by the self-loop guard.
    const analyzer = fakeAnalyzer({
      [A]: [dep(B)],
      [B]: [dep(A)],
    });
    const crawler = new SpiderGraphCrawler(analyzer, noConfig);

    const { edges } = await crawler.crawl(A);

    expect(detectCycles(edges).size).toBe(2);
  });

  it('crawlFrom also drops self-loop edges', async () => {
    const analyzer = fakeAnalyzer({
      [A]: [dep(A, 'pty'), dep(B, 'defs')],
      [B]: [],
    });
    const crawler = new SpiderGraphCrawler(analyzer, noConfig);

    const { edges } = await crawler.crawlFrom(A, new Set<string>([A]));

    expect(edges.some((e) => e.source === e.target)).toBe(false);
    expect(edges).toContainEqual({ source: A, target: B });
  });
});

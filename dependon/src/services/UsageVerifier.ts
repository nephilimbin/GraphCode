/**
 * UsageVerifier — dependency-usage verification, dependents lookup, and
 * execution tracing.
 *
 * Behaviour ported 1:1 from `SpiderSymbolService.verifyDependencyUsage` /
 * `verifyDependencyUsageBatch` / `getSymbolDependents` /
 * `traceFunctionExecution` and the private helpers `collectSymbolDependents`,
 * `markAllAsUsed`, `markAllAsUnused`, `buildResolvedTargetsSet`,
 * `checkTargetsAgainstResolved`, `isAstUnsupportedFile` in the analyzer crate.
 * Only import paths, logger name and error class were adapted for the dependon
 * package.
 *
 * To avoid a circular dependency on {@link SymbolGraphReader}, the verifier
 * receives `getSymbolGraph` as an injected callback rather than importing the
 * reader directly. The same applies to `findReferencingFiles`, which is owned
 * by the reverse-index layer.
 *
 * @module dependon/services
 */

import { getLogger } from '../core/Logger';
import { DependonError } from '../core/Errors';
import { normalizePath } from '../core/Path';
import { isInIgnoredDirectory } from '../core/PathPredicates';
import { SymbolDependencyHelper } from '../core/SymbolDependencyHelper';
import { PathResolver } from '../resolution/PathResolver';
import type { Dependency } from '../domain/Dependency';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';

const log = getLogger('UsageVerifier');

/** Intra-file symbol graph: exported symbols and their dependency edges. */
type SymbolGraph = { symbols: SymbolInfo[]; dependencies: SymbolDependency[] };

/** Provides the files that reference a target path (reverse-index backed). */
export type ReferencingFilesProvider = (targetPath: string) => Promise<Dependency[]>;

/**
 * Verifies whether source files actually use symbols from target files, lists
 * symbol dependents, and traces function execution chains.
 *
 * Single responsibility: usage/dependents/tracing queries. It does not build
 * the symbol graph itself — that is injected as `getSymbolGraph` (typically
 * bound to a {@link SymbolGraphReader} instance by the composition root).
 */
export class UsageVerifier {
  constructor(
    private readonly getSymbolGraph: (filePath: string) => Promise<SymbolGraph>,
    private readonly resolver: PathResolver,
    private readonly symbolDependencyHelper: SymbolDependencyHelper,
    private readonly findReferencingFiles: ReferencingFilesProvider
  ) {}

  async getSymbolDependents(filePath: string, symbolName: string): Promise<SymbolDependency[]> {
    const referencingFiles = await this.findReferencingFiles(filePath);
    return this.collectSymbolDependents(referencingFiles, filePath, symbolName);
  }

  async traceFunctionExecution(
    filePath: string,
    symbolName: string,
    maxDepth: number = 10
  ): Promise<{
    rootSymbol: { id: string; filePath: string; symbolName: string };
    callChain: Array<{
      depth: number;
      callerSymbolId: string;
      calledSymbolId: string;
      calledFilePath: string;
      resolvedFilePath: string | null;
    }>;
    visitedSymbols: string[];
    maxDepthReached: boolean;
  }> {
    const rootId = `${filePath}:${symbolName}`;
    const callChain: Array<{
      depth: number;
      callerSymbolId: string;
      calledSymbolId: string;
      calledFilePath: string;
      resolvedFilePath: string | null;
    }> = [];
    const visitedSymbols = new Set<string>();
    let maxDepthReached = false;

    const trace = async (currentFilePath: string, currentSymbolName: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        maxDepthReached = true;
        return;
      }

      const currentId = `${currentFilePath}:${currentSymbolName}`;
      if (visitedSymbols.has(currentId)) {
        return;
      }
      visitedSymbols.add(currentId);

      try {
        const { symbols, dependencies } = await this.getSymbolGraph(currentFilePath);
        const currentSymbol = symbols.find((s) => s.name === currentSymbolName);
        if (!currentSymbol) return;

        const symbolDeps = dependencies.filter((d) => d.sourceSymbolId === currentSymbol.id);

        for (const dep of symbolDeps) {
          let resolvedFilePath: string | null = null;
          try {
            resolvedFilePath = await this.resolver.resolve(currentFilePath, dep.targetFilePath);
          } catch {
            // keep null
          }

          const targetSymbolName = dep.targetSymbolId.split(':').pop() || '';

          callChain.push({
            depth,
            callerSymbolId: currentId,
            calledSymbolId: dep.targetSymbolId,
            calledFilePath: dep.targetFilePath,
            resolvedFilePath,
          });

          if (resolvedFilePath && !isInIgnoredDirectory(resolvedFilePath)) {
            await trace(resolvedFilePath, targetSymbolName, depth + 1);
          }
        }
      } catch (error) {
        const dependonError = DependonError.fromError(error, currentFilePath);
        log.error('Trace execution failed:', currentId, dependonError.toUserMessage());
      }
    };

    await trace(filePath, symbolName, 1);

    return {
      rootSymbol: { id: rootId, filePath, symbolName },
      callChain,
      visitedSymbols: Array.from(visitedSymbols),
      maxDepthReached,
    };
  }

  /**
   * Verify if a source file actually uses any symbol from a target file.
   * This is used to filter out unused imports from the graph.
   *
   * OPTIMIZATION: Uses cached symbol graph when available to minimize AST parsing.
   */
  async verifyDependencyUsage(sourceFile: string, targetFile: string): Promise<boolean> {
    try {
      // Normalize paths for comparison
      const normalizedSource = normalizePath(sourceFile);
      const normalizedTarget = normalizePath(targetFile);

      // Early exit: if target is in node_modules or ignored directory, assume used
      if (isInIgnoredDirectory(normalizedTarget)) {
        return true;
      }

      // GraphQL, C#, Go, and Java files don't support AST-based symbol analysis here, so skip verification
      // These languages may still use tree-sitter for file-level imports, but without AST-based symbol verification all imports are considered used
      if (this.isAstUnsupportedFile(normalizedSource)) {
        log.debug(`Skipping symbol analysis for unsupported file type: ${normalizedSource}`);
        return true; // Without AST-based symbol verification, conservatively treat all imports as used
      }

      // 1. Get AST-based symbol dependencies for the source file (cached)
      const { dependencies } = await this.getSymbolGraph(normalizedSource);

      if (dependencies.length === 0) {
        return false; // No dependencies at all
      }

      // 2. Check if any dependency points to the target file
      // OPTIMIZATION: Pre-filter by checking if targetFilePath contains the target basename
      // to avoid expensive path resolution for obviously unrelated dependencies
      const targetBasename = normalizedTarget.split('/').pop() || '';
      const candidateDeps = dependencies.filter(dep =>
        dep.targetFilePath === normalizedTarget ||
        dep.targetFilePath.includes(targetBasename) ||
        !dep.targetFilePath.startsWith('/')
      );

      for (const dep of candidateDeps) {
        // Use helper to resolve module specifier to absolute path and compare
        const isMatch = await this.symbolDependencyHelper.doesDependencyTargetFile(
          dep,
          normalizedSource,
          normalizedTarget
        );

        if (isMatch) {
          return true; // If we find at least one used symbol, the dependency is "used"
        }
      }

      return false;
    } catch (error) {
        // If analysis fails, assume used to be safe (avoid hiding potentially useful links)
        const dependonError = DependonError.fromError(error, sourceFile);
        log.warn('Usage verification failed, assuming used:', dependonError.message);
        return true;
    }
  }

  /**
   * BATCH OPTIMIZATION: Verify multiple target files from the same source in one pass.
   * This is more efficient than calling verifyDependencyUsage() multiple times
   * because it only fetches the source's symbol graph once.
   *
   * @param sourceFile - The source file to check
   * @param targetFiles - Array of target files to verify
   * @returns Map of targetFile -> isUsed
   */
  async verifyDependencyUsageBatch(sourceFile: string, targetFiles: string[]): Promise<Map<string, boolean>> {
    try {
      const normalizedSource = normalizePath(sourceFile);

      // GraphQL, C#, Go, and Java files don't support AST symbol analysis - all imports are considered used
      if (this.isAstUnsupportedFile(normalizedSource)) {
        log.debug(`Skipping symbol analysis for unsupported file type: ${normalizedSource}`);
        return this.markAllAsUsed(targetFiles);
      }

      // Get symbol graph once for all targets
      const { dependencies } = await this.getSymbolGraph(normalizedSource);

      if (dependencies.length === 0) {
        return this.markAllAsUnused(targetFiles);
      }

      // Build resolved target paths set
      const resolvedTargets = await this.buildResolvedTargetsSet(dependencies, normalizedSource);

      // Check each target against the resolved set
      return this.checkTargetsAgainstResolved(targetFiles, resolvedTargets);
    } catch (error) {
      // On error, assume all used to be safe
      const dependonError = DependonError.fromError(error, sourceFile);
      log.warn('Batch usage verification failed, assuming all used:', dependonError.message);
      return this.markAllAsUsed(targetFiles);
    }
  }

  private markAllAsUsed(targetFiles: string[]): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const target of targetFiles) {
      results.set(normalizePath(target), true);
    }
    return results;
  }

  private markAllAsUnused(targetFiles: string[]): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const target of targetFiles) {
      results.set(normalizePath(target), false);
    }
    return results;
  }

  private async buildResolvedTargetsSet(
    dependencies: SymbolDependency[],
    normalizedSource: string
  ): Promise<Set<string>> {
    const resolvedTargets = new Set<string>();
    for (const dep of dependencies) {
      try {
        const resolved = await this.symbolDependencyHelper.resolveTargetPath(dep, normalizedSource);
        if (resolved) {
          resolvedTargets.add(normalizePath(resolved));
        }
      } catch {
        // Ignore resolution errors
      }
    }
    return resolvedTargets;
  }

  private checkTargetsAgainstResolved(
    targetFiles: string[],
    resolvedTargets: Set<string>
  ): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const target of targetFiles) {
      const normalizedTarget = normalizePath(target);

      // Early exit: if target is in ignored directory, assume used
      if (isInIgnoredDirectory(normalizedTarget)) {
        results.set(normalizedTarget, true);
        continue;
      }

      results.set(normalizedTarget, resolvedTargets.has(normalizedTarget));
    }
    return results;
  }

  /**
   * Check if a file is NOT supported by the AST worker for symbol analysis.
   * The AST worker only handles TypeScript/JavaScript, Python, and Rust.
   * C#, Go, and Java files use file-level parsers only — symbol-level
   * verification would always return empty dependencies, causing all
   * of their imports to be incorrectly marked as unused.
   */
  private isAstUnsupportedFile(filePath: string): boolean {
    return (
      filePath.endsWith('.gql') ||
      filePath.endsWith('.graphql') ||
      filePath.endsWith('.cs') ||
      filePath.endsWith('.csproj') ||
      filePath.endsWith('.go') ||
      filePath.endsWith('.java')
    );
  }

  private async collectSymbolDependents(
    referencingFiles: Dependency[],
    targetFilePath: string,
    symbolName: string
  ): Promise<SymbolDependency[]> {
    const dependents: SymbolDependency[] = [];
    const normalizedTarget = normalizePath(targetFilePath);

    for (const ref of referencingFiles) {
      const { dependencies } = await this.getSymbolGraph(ref.path);

      for (const dep of dependencies) {
        const isMatch = await this.symbolDependencyHelper.doesDependencyTargetFile(dep, ref.path, normalizedTarget);
        if (isMatch && this.symbolDependencyHelper.extractSymbolName(dep.targetSymbolId) === symbolName) {
          dependents.push(dep);
        }
      }
    }

    return dependents;
  }
}

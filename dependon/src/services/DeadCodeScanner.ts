/**
 * DeadCodeScanner — finds unused exported symbols per-file and workspace-wide.
 *
 * Behaviour ported 1:1 from `SpiderSymbolService.findUnusedSymbols` /
 * `scanDeadCode` / private `expandUsedSymbolsViaInternalGraph` /
 * `collectUsedSymbolIds` in the analyzer crate. Only import paths, logger
 * name and error class were adapted for the dependon package.
 *
 * To avoid a circular dependency on {@link SymbolGraphReader}, the scanner
 * receives `getSymbolGraph` as an injected callback rather than importing the
 * reader directly. The same applies to `findReferencingFiles`, which is owned
 * by the reverse-index layer.
 *
 * @module dependon/services
 */

import path from 'node:path';
import { getLogger } from '../core/Logger';
import { DependonError, DependonErrorCode } from '../core/Errors';
import { normalizePath } from '../core/Path';
import { SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS } from '../core/Constants';
import { AstWorkerHost } from '../infra/AstWorkerHost';
import { FileReader } from '../infra/FileReader';
import { SourceFileCollector } from '../resolution/SourceFileCollector';
import { SymbolDependencyHelper } from '../core/SymbolDependencyHelper';
import type { Dependency } from '../domain/Dependency';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';
import type { AnalyzerConfig } from '../domain/Config';

const log = getLogger('DeadCodeScanner');

/** Intra-file symbol graph: exported symbols and their dependency edges. */
type SymbolGraph = { symbols: SymbolInfo[]; dependencies: SymbolDependency[] };

/** Provides the files that reference a target path (reverse-index backed). */
export type ReferencingFilesProvider = (targetPath: string) => Promise<Dependency[]>;

/**
 * Finds unused exported symbols.
 *
 * Single responsibility: dead-code detection. It does not build the symbol
 * graph itself — that is injected as `getSymbolGraph` (typically bound to a
 * {@link SymbolGraphReader} instance by the composition root).
 */
export class DeadCodeScanner {
  constructor(
    private readonly getSymbolGraph: (filePath: string) => Promise<SymbolGraph>,
    private readonly astWorkerHost: AstWorkerHost,
    private readonly fileReader: FileReader,
    private readonly findReferencingFiles: ReferencingFilesProvider,
    private readonly symbolDependencyHelper: SymbolDependencyHelper,
    private readonly getConfig: () => AnalyzerConfig
  ) {}

  async findUnusedSymbols(filePath: string): Promise<SymbolInfo[]> {
    try {
      const normalizedTarget = normalizePath(filePath);
      const { symbols } = await this.getSymbolGraph(normalizedTarget);
      const exportedSymbols = symbols.filter((s) => s.isExported);
      if (exportedSymbols.length === 0) {
        return [];
      }

      const referencingFiles = await this.findReferencingFiles(normalizedTarget);
      const usedSymbolIds = await this.collectUsedSymbolIds(referencingFiles, normalizedTarget);

      const content = await this.fileReader.readFile(normalizedTarget);
      const internalGraph = await this.astWorkerHost.getInternalExportDependencyGraph(normalizedTarget, content);
      const usedWithClosure = this.expandUsedSymbolsViaInternalGraph(usedSymbolIds, internalGraph);

      return exportedSymbols.filter((s) => !usedWithClosure.has(s.id));
    } catch (error) {
      const dependonError = DependonError.fromError(error, filePath);
      log.error('Find unused symbols failed:', dependonError.toUserMessage());
      return [];
    }
  }

  /**
   * Scan all files under `scopePath` for unused exported symbols.
   *
   * @param scopePath - Absolute path to a directory (or file) to scope the
   *   scan.  Must be inside the workspace root (caller is responsible for
   *   validating this).
   * @param options.maxFiles - Hard cap on files analysed (default: 500).
   * @param options.hasReverseIndex - Whether the reverse index is available.
   *   If false, throws INDEX_NOT_READY — we never fall back to O(n²) lookups.
   * @returns Array of { filePath, unusedSymbols } entries (only files that
   *   have at least one unused export are included).
   */
  async scanDeadCode(
    scopePath: string,
    options: { maxFiles?: number; hasReverseIndex: boolean }
  ): Promise<{ entries: Array<{ filePath: string; unusedSymbols: SymbolInfo[] }>; scannedFiles: number; skippedFiles: number }> {
    const { maxFiles = 500, hasReverseIndex } = options;

    if (!hasReverseIndex) {
      throw new DependonError(
        'Dead code scan requires the reverse index. Wait for indexing to complete or call rebuild_index first.',
        DependonErrorCode.INDEX_NOT_READY,
      );
    }

    const config = this.getConfig();
    const collector = new SourceFileCollector({
      excludeNodeModules: config.excludeNodeModules ?? true,
    });

    // Collect all source files under scopePath
    const allFiles = await collector.collectAllSourceFiles(scopePath);

    // Filter to files supported by the symbol analyser
    const SUPPORTED_EXTENSIONS_SET = new Set(SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS as readonly string[]);
    const analysableFiles = allFiles.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXTENSIONS_SET.has(ext);
    });

    // Apply hard cap
    const filesToScan = analysableFiles.slice(0, maxFiles);

    const entries: Array<{ filePath: string; unusedSymbols: SymbolInfo[] }> = [];
    let skippedFiles = 0;

    for (const filePath of filesToScan) {
      try {
        const unusedSymbols = await this.findUnusedSymbols(filePath);
        if (unusedSymbols.length > 0) {
          entries.push({ filePath, unusedSymbols });
        }
      } catch (error) {
        // Per-file errors are silently skipped so the batch continues.
        const dependonError = DependonError.fromError(error, filePath);
        log.warn('scanDeadCode: skipping file due to error:', filePath, dependonError.message);
        skippedFiles++;
      }
    }

    return { entries, scannedFiles: filesToScan.length, skippedFiles };
  }

  private expandUsedSymbolsViaInternalGraph(used: Set<string>, internalGraph: Map<string, Set<string>>): Set<string> {
    const expanded = new Set<string>(used);
    const queue: string[] = Array.from(expanded);

    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) continue;
      const deps = internalGraph.get(current);
      if (!deps) continue;
      for (const dep of deps) {
        if (expanded.has(dep)) continue;
        expanded.add(dep);
        queue.push(dep);
      }
    }

    return expanded;
  }

  private async collectUsedSymbolIds(referencingFiles: Dependency[], targetFilePath: string): Promise<Set<string>> {
    const usedSymbolIds = new Set<string>();

    for (const ref of referencingFiles) {
      const { dependencies } = await this.getSymbolGraph(ref.path);

      for (const dep of dependencies) {
        const isMatch = await this.symbolDependencyHelper.doesDependencyTargetFile(dep, ref.path, targetFilePath);
        if (isMatch) {
          const symbolName = this.symbolDependencyHelper.extractSymbolName(dep.targetSymbolId);
          usedSymbolIds.add(this.symbolDependencyHelper.buildUsedSymbolId(targetFilePath, symbolName));
        }
      }
    }

    return usedSymbolIds;
  }
}

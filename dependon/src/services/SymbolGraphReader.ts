/**
 * SymbolGraphReader — builds and caches the per-file symbol dependency graph.
 *
 * Reads a source file via the AST worker, resolves module specifiers in each
 * dependency edge to absolute paths (language-specific), and caches the result.
 *
 * Behaviour ported 1:1 from `SpiderSymbolService.getSymbolGraph` /
 * `resolveModuleSpecifier` in the analyzer crate. Only import paths, logger
 * name and error class were adapted for the dependon package.
 *
 * @module dependon/services
 */

import path from 'node:path';
import { getLogger } from '../core/Logger';
import { DependonError } from '../core/Errors';
import { normalizePath } from '../core/Path';
import { AstWorkerHost } from '../infra/AstWorkerHost';
import { LRUCache } from '../infra/LRUCache';
import { FileReader } from '../infra/FileReader';
import { LanguageService } from '../languages/LanguageService';
import { PathResolver } from '../resolution/PathResolver';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';
import type { AnalyzerConfig } from '../domain/Config';

const log = getLogger('SymbolGraphReader');

/** Intra-file symbol graph: exported symbols and their dependency edges. */
export type SymbolGraph = { symbols: SymbolInfo[]; dependencies: SymbolDependency[] };

/**
 * Builds and caches the symbol dependency graph for a single source file.
 *
 * Single responsibility: file -> SymbolGraph. Does not perform dead-code,
 * dependents, or usage analysis (see {@link DeadCodeScanner},
 * {@link UsageVerifier}).
 */
export class SymbolGraphReader {
  constructor(
    private readonly astWorkerHost: AstWorkerHost,
    private readonly symbolCache: LRUCache<SymbolGraph>,
    private readonly fileReader: FileReader,
    private readonly resolver: PathResolver,
    private readonly languageService: LanguageService,
    private readonly getConfig: () => AnalyzerConfig
  ) {}

  async getSymbolGraph(filePath: string): Promise<SymbolGraph> {
    if (!path.isAbsolute(filePath)) {
      try {
        const maybeResolved = await this.resolveModuleSpecifier(this.getConfig().rootDir, filePath);
        if (maybeResolved) {
          filePath = maybeResolved;
        }
      } catch {
        // ignore
      }
    }

    const key = normalizePath(filePath);
    const cached = this.symbolCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const content = await this.fileReader.readFile(filePath);
      const result = await this.astWorkerHost.analyzeFile(key, content);

      // Resolve targetFilePath in dependencies from module specifier to absolute path
      // This is critical for cross-platform path comparison in verifyDependencyUsage
      // Use language-specific resolver (Python, TypeScript, etc.)
      const resolvedDependencies = await Promise.all(
        result.dependencies.map(async (dep) => {
          try {
            // Get language-specific analyzer
            const analyzer = this.languageService.getAnalyzer(key);
            const resolved = await analyzer.resolvePath(key, dep.targetFilePath);
            if (resolved) {
              return {
                ...dep,
                targetFilePath: normalizePath(resolved),
              };
            }
          } catch {
            // If resolution fails, keep original module specifier
          }
          return dep;
        })
      );

      const resolvedResult = {
        symbols: result.symbols,
        dependencies: resolvedDependencies,
      };

      this.symbolCache.set(key, resolvedResult);
      return resolvedResult;
    } catch (error) {
      const dependonError = DependonError.fromError(error, filePath);
      log.error('Symbol analysis failed:', dependonError.toUserMessage());
      if (dependonError.isRecoverable()) {
        return { symbols: [], dependencies: [] };
      }
      throw dependonError;
    }
  }

  async resolveModuleSpecifier(fromFilePath: string, moduleSpecifier: string): Promise<string | null> {
    try {
      const resolved = await this.resolver.resolve(fromFilePath, moduleSpecifier);
      return resolved;
    } catch {
      return null;
    }
  }
}

import type { AstWorkerHost } from '../ast/AstWorkerHost';
import type { Cache } from '../indexing/Cache';
import type { IndexerStatus, IndexerStatusSnapshot } from '../indexing/IndexerStatus';
import type { ReverseIndexManager } from '../indexing/ReverseIndexManager';
import type { SourceFileCollector } from '../source/SourceFileCollector';
import type { SpiderCacheCoordinator } from './spider/SpiderCacheCoordinator';
import type { SpiderDependencyAnalyzer } from './spider/SpiderDependencyAnalyzer';
import type { SpiderGraphCrawler } from './spider/SpiderGraphCrawler';
import type { SpiderIndexingService } from './spider/SpiderIndexingService';
import type { SpiderReferenceLookup } from './spider/SpiderReferenceLookup';
import type { SpiderSymbolService } from './spider/SpiderSymbolService';
import type { Dependency, IndexingProgressCallback, SpiderConfig } from '../foundation/types';
import type { PathResolver } from '../source/PathResolver';
import type { SpiderServices } from './SpiderServices';

/**
 * Main analyzer class - "The Spider"
 *
 * This class is a thin facade that composes multiple single-responsibility services
 * for dependency analysis, symbol extraction, and graph traversal.
 *
 * **IMPORTANT:** Use {@link SpiderBuilder} to construct Spider instances. The builder provides
 * a fluent, type-safe API for configuration and handles complex service initialization automatically.
 *
 * @example Basic usage with SpiderBuilder
 * ```typescript
 * import { SpiderBuilder } from './SpiderBuilder';
 * 
 * const spider = new SpiderBuilder()
 *   .withRootDir('/path/to/project')
 *   .withMaxDepth(50)
 *   .withReverseIndex(true)
 *   .build();
 * 
 * // Analyze a file
 * const deps = await spider.analyze('src/index.ts');
 * 
 * // Crawl dependency graph
 * const graph = await spider.crawl('src/index.ts');
 * 
 * // Clean up
 * await spider.dispose();
 * ```
 *
 * @example Advanced configuration
 * ```typescript
 * const spider = new SpiderBuilder()
 *   .withRootDir('/path/to/project')
 *   .withTsConfigPath('./tsconfig.json')
 *   .withMaxDepth(100)
 *   .withExcludeNodeModules(true)
 *   .withReverseIndex(true)
 *   .withIndexingConcurrency(8)
 *   .withCacheConfig({
 *     maxCacheSize: 1000,
 *     maxSymbolCacheSize: 500,
 *     maxSymbolAnalyzerFiles: 200
 *   })
 *   .build();
 * ```
 *
 * @example Testing with custom services
 * ```typescript
 * const mockCache = new Cache({ maxSize: 10 });
 * const mockLanguageService = createMockLanguageService();
 * 
 * const spider = new SpiderBuilder()
 *   .withRootDir('/test/project')
 *   .withCache(mockCache)
 *   .withLanguageService(mockLanguageService)
 *   .build();
 * ```
 *
 * @example Symbol-level analysis
 * ```typescript
 * const spider = new SpiderBuilder()
 *   .withRootDir('/path/to/project')
 *   .build();
 * 
 * // Get symbol graph for a file
 * const { symbols, dependencies } = await spider.getSymbolGraph('src/utils.ts');
 * 
 * // Find unused symbols
 * const unused = await spider.findUnusedSymbols('src/utils.ts');
 * 
 * // Trace function execution
 * const trace = await spider.traceFunctionExecution('src/app.ts', 'handleRequest', 10);
 * ```
 *
 * @example Background indexing
 * ```typescript
 * const spider = new SpiderBuilder()
 *   .withRootDir('/path/to/project')
 *   .withReverseIndex(true)
 *   .withIndexingConcurrency(4)
 *   .build();
 * 
 * // Build full index with progress callback
 * const result = await spider.buildFullIndex((progress) => {
 *   console.log(`Indexed ${progress.completed}/${progress.total} files`);
 * });
 * 
 * console.log(`Indexed ${result.indexedFiles} files in ${result.duration}ms`);
 * ```
 *
 * CRITICAL ARCHITECTURE RULE: This module is completely VS Code agnostic!
 * NO import * as vscode from 'vscode' allowed!
 * Only Node.js built-in modules (fs, path) are permitted (indirectly via services).
 *
 * @see {@link SpiderBuilder} for the recommended way to construct Spider instances
 */
export class Spider {
  private readonly config: SpiderConfig;

  private readonly resolver: PathResolver;

  // Kept as `cache` for backward compatibility (some tests/tools access it dynamically).
  private readonly cache: Cache<Dependency[]>;
  private readonly symbolCache: Cache<{
    symbols: import('../foundation/types').SymbolInfo[];
    dependencies: import('../foundation/types').SymbolDependency[];
  }>;
  private readonly astWorkerHost: AstWorkerHost;

  private readonly reverseIndexManager: ReverseIndexManager;
  private readonly indexerStatus: IndexerStatus;

  private readonly sourceFileCollector: SourceFileCollector;

  private readonly dependencyAnalyzer: SpiderDependencyAnalyzer;
  private readonly referenceLookup: SpiderReferenceLookup;
  private readonly symbolService: SpiderSymbolService;
  private readonly graphCrawler: SpiderGraphCrawler;
  private readonly indexingService: SpiderIndexingService;
  private readonly cacheCoordinator: SpiderCacheCoordinator;

  /**
   * Construct a Spider instance.
   * 
   * **IMPORTANT:** This constructor is internal and should not be called directly.
   * Use {@link SpiderBuilder} instead for a fluent, type-safe configuration API.
   * 
   * @internal
   * 
   * @example Recommended approach (use SpiderBuilder)
   * ```typescript
   * import { SpiderBuilder } from './SpiderBuilder';
   * 
   * const spider = new SpiderBuilder()
   *   .withRootDir('/path/to/project')
   *   .withMaxDepth(50)
   *   .withReverseIndex(true)
   *   .build();
   * ```
   * 
   * @example Legacy approach (backward compatibility only)
   * ```typescript
   * // Direct construction is supported for backward compatibility
   * // but SpiderBuilder is strongly recommended for new code
   * const spider = new Spider({
   *   rootDir: '/path/to/project',
   *   maxDepth: 50,
   *   enableReverseIndex: true
   * });
   * ```
   * 
   * @param services - Fully initialized SpiderServices (constructed by {@link SpiderBuilder})
   */
  constructor(services: SpiderServices) {
    this.config = services.config;
    this.resolver = services.resolver;
    this.cache = services.cache;
    this.symbolCache = services.symbolCache;
    this.astWorkerHost = services.astWorkerHost;
    this.reverseIndexManager = services.reverseIndexManager;
    this.indexerStatus = services.indexerStatus;
    this.sourceFileCollector = services.sourceFileCollector;
    this.dependencyAnalyzer = services.dependencyAnalyzer;
    this.referenceLookup = services.referenceLookup;
    this.symbolService = services.symbolService;
    this.graphCrawler = services.graphCrawler;
    this.indexingService = services.indexingService;
    this.cacheCoordinator = services.cacheCoordinator;
  }

  /**
   * Stop the Spider and clean up resources
   */
  async dispose(): Promise<void> {
    await this.astWorkerHost.stop();
  }

  updateConfig(config: Partial<SpiderConfig>) {
    this.config.excludeNodeModules = config.excludeNodeModules ?? this.config.excludeNodeModules;
    this.config.maxDepth = config.maxDepth ?? this.config.maxDepth;

    if (config.excludeNodeModules !== undefined) {
      this.resolver.updateConfig(config.excludeNodeModules);
      this.sourceFileCollector.updateOptions({ excludeNodeModules: config.excludeNodeModules });
    }

    if (config.enableReverseIndex !== undefined) {
      this.config.enableReverseIndex = config.enableReverseIndex;
      if (config.enableReverseIndex) {
        this.reverseIndexManager.enable();
      } else {
        this.reverseIndexManager.disable();
      }
    }

    if (config.indexingConcurrency !== undefined) {
      this.config.indexingConcurrency = config.indexingConcurrency;
    }

    this.clearCache();
  }

  async analyze(filePath: string): Promise<Dependency[]> {
    return this.dependencyAnalyzer.analyze(filePath);
  }

  clearCache(): void {
    this.cacheCoordinator.clearAll();
    this.referenceLookup.clearFallbackCache();
  }

  invalidateFile(filePath: string): boolean {
    this.referenceLookup.clearFallbackCache();
    return this.cacheCoordinator.invalidateFile(filePath);
  }

  invalidateFiles(filePaths: string[]): number {
    this.referenceLookup.clearFallbackCache();
    return this.cacheCoordinator.invalidateFiles(filePaths);
  }

  async reanalyzeFile(filePath: string): Promise<Dependency[] | null> {
    this.invalidateFile(filePath);
    try {
      return await this.analyze(filePath);
    } catch {
      return null;
    }
  }

  handleFileDeleted(filePath: string): void {
    this.referenceLookup.clearFallbackCache();
    this.cacheCoordinator.handleFileDeleted(filePath);
  }

  enableReverseIndex(serializedData?: string): boolean {
    const restored = this.reverseIndexManager.enable(serializedData);
    this.config.enableReverseIndex = true;
    return restored;
  }

  disableReverseIndex(): void {
    this.config.enableReverseIndex = false;
    this.reverseIndexManager.disable();
  }

  getSerializedReverseIndex(): string | null {
    return this.reverseIndexManager.getSerialized();
  }

  async validateReverseIndex(staleThreshold = 0.2): Promise<{
    isValid: boolean;
    staleFiles: string[];
    stalePercentage: number;
    missingFiles: string[];
  } | null> {
    return this.reverseIndexManager.validate(staleThreshold);
  }

  getIndexStatus(): IndexerStatusSnapshot {
    return this.indexerStatus.getSnapshot();
  }

  subscribeToIndexStatus(callback: (snapshot: IndexerStatusSnapshot) => void): () => void {
    return this.indexerStatus.subscribe(callback);
  }

  hasReverseIndex(): boolean {
    return this.reverseIndexManager.hasEntries();
  }

  getCallerCount(targetPath: string): number {
    if (!this.reverseIndexManager.hasEntries()) {
      return 0;
    }
    return this.reverseIndexManager.getCallerCount(targetPath);
  }

  cancelIndexing(): void {
    this.indexingService.cancel();
  }

  async buildFullIndex(
    progressCallback?: IndexingProgressCallback
  ): Promise<{ indexedFiles: number; duration: number; cancelled: boolean }> {
    return this.indexingService.buildFullIndex(progressCallback);
  }

  async buildFullIndexInWorker(
    workerPath: string,
    progressCallback?: IndexingProgressCallback
  ): Promise<{ indexedFiles: number; duration: number; cancelled: boolean }> {
    return this.indexingService.buildFullIndexInWorker(workerPath, progressCallback);
  }

  disposeWorker(): void {
    this.indexingService.disposeWorker();
  }

  async reindexStaleFiles(staleFiles: string[], progressCallback?: IndexingProgressCallback): Promise<number> {
    return this.indexingService.reindexStaleFiles(staleFiles, progressCallback);
  }

  async crawl(
    startPath: string
  ): Promise<{ nodes: string[]; edges: { source: string; target: string }[]; nodeLabels?: Record<string, string> }> {
    return this.graphCrawler.crawl(startPath);
  }

  async crawlFrom(
    startNode: string,
    existingNodes: Set<string>,
    extraDepth: number = 10,
    options?: {
      onBatch?: (batch: { nodes: string[]; edges: { source: string; target: string }[]; nodeLabels?: Record<string, string> }) => Promise<void> | void;
      batchSize?: number;
      signal?: AbortSignal;
      totalHint?: number;
    }
  ): Promise<{ nodes: string[]; edges: { source: string; target: string }[]; nodeLabels?: Record<string, string> }> {
    return this.graphCrawler.crawlFrom(startNode, existingNodes, extraDepth, options);
  }

  async findReferencingFiles(targetPath: string): Promise<Dependency[]> {
    return this.referenceLookup.findReferencingFiles(targetPath);
  }

  /**
   * Get files that reference a specific exported symbol
   * @param symbolId Symbol ID in format "filePath:symbolName" (e.g., "src/utils.ts:formatDate")
   * @returns Set of file paths that import/reference the symbol
   */
  getSymbolReferencingFiles(symbolId: string): Set<string> {
    if (!this.reverseIndexManager.hasEntries()) {
      return new Set();
    }
    const files = this.reverseIndexManager.getSymbolReferencingFiles(symbolId);
    return new Set(files);
  }

  async getSymbolGraph(filePath: string): Promise<{
    symbols: import('../foundation/types').SymbolInfo[];
    dependencies: import('../foundation/types').SymbolDependency[];
  }> {
    return this.symbolService.getSymbolGraph(filePath);
  }

  async resolveModuleSpecifier(fromFilePath: string, moduleSpecifier: string): Promise<string | null> {
    return this.dependencyAnalyzer.resolveModuleSpecifier(fromFilePath, moduleSpecifier);
  }

  async findUnusedSymbols(filePath: string): Promise<import('../foundation/types').SymbolInfo[]> {
    return this.symbolService.findUnusedSymbols(filePath);
  }

  async scanDeadCode(
    scopePath?: string,
    options?: { maxFiles?: number }
  ): Promise<{ entries: Array<{ filePath: string; unusedSymbols: import('../foundation/types').SymbolInfo[] }>; scannedFiles: number; skippedFiles: number }> {
    const resolvedScope = scopePath ?? this.config.rootDir;
    return this.symbolService.scanDeadCode(resolvedScope, {
      maxFiles: options?.maxFiles,
      hasReverseIndex: this.hasReverseIndex(),
    });
  }

  async verifyDependencyUsage(sourceFile: string, targetFile: string): Promise<boolean> {
    return this.symbolService.verifyDependencyUsage(sourceFile, targetFile);
  }

  async verifyDependencyUsageBatch(sourceFile: string, targetFiles: string[]): Promise<Map<string, boolean>> {
    return this.symbolService.verifyDependencyUsageBatch(sourceFile, targetFiles);
  }

  async getSymbolDependents(filePath: string, symbolName: string): Promise<import('../foundation/types').SymbolDependency[]> {
    return this.symbolService.getSymbolDependents(filePath, symbolName);
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
    return this.symbolService.traceFunctionExecution(filePath, symbolName, maxDepth);
  }

  /**
   * Get cache stats (synchronous, file count may be 0 if worker not queried yet)
   */
  getCacheStats(): {
    dependencyCache: import('../indexing/Cache').CacheStats;
    symbolCache: import('../indexing/Cache').CacheStats;
    symbolAnalyzerFileCount: number;
    reverseIndexStats?: { indexedFiles: number; targetFiles: number; totalReferences: number };
  } {
    return {
      dependencyCache: this.cache.getStats(),
      symbolCache: this.symbolCache.getStats(),
      symbolAnalyzerFileCount: 0, // Use getCacheStatsAsync() for accurate count
      reverseIndexStats: this.reverseIndexManager.getStats(),
    };
  }

  /**
   * Get cache stats with accurate AST worker file count (async)
   */
  async getCacheStatsAsync(): Promise<{
    dependencyCache: import('../indexing/Cache').CacheStats;
    symbolCache: import('../indexing/Cache').CacheStats;
    symbolAnalyzerFileCount: number;
    reverseIndexStats?: { indexedFiles: number; targetFiles: number; totalReferences: number };
  }> {
    // Get file count from worker (returns 0 if worker not started yet)
    let fileCount = 0;
    try {
      fileCount = await this.astWorkerHost.getFileCount();
    } catch {
      // Worker not started yet or error - return 0
    }
    
    return {
      dependencyCache: this.cache.getStats(),
      symbolCache: this.symbolCache.getStats(),
      symbolAnalyzerFileCount: fileCount,
      reverseIndexStats: this.reverseIndexManager.getStats(),
    };
  }
}

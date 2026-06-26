import type { AnalyzerConfig } from '../domain/Config';
import type { Dependency, IndexingProgressCallback } from '../domain/Dependency';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';
import type { PathResolver } from '../resolution/PathResolver';
import type { SourceFileCollector } from '../resolution/SourceFileCollector';
import type { LRUCache } from '../infra/LRUCache';
import type { AstWorkerHost } from '../infra/AstWorkerHost';
import type { IndexerStatus, IndexerStatusSnapshot } from '../indexing/IndexerStatus';
import type { ReverseIndexStore } from '../indexing/ReverseIndexStore';
import type { AnalyzerServices } from './AnalyzerBuilder';

/**
 * Analyzer — dependon main facade ("the engine").
 *
 * Thin facade that composes single-responsibility services for dependency
 * analysis, symbol extraction, reverse indexing, and graph traversal.
 *
 * **Construction**: use {@link AnalyzerBuilder} for a fluent, type-safe API.
 *
 * **Architecture rule**: this module is completely VS Code-agnostic. Only
 * Node.js built-ins (fs, path) are permitted (indirectly via services).
 *
 * @module dependon/facade
 */
export class Analyzer {
  private readonly config: AnalyzerConfig;
  private readonly resolver: PathResolver;
  private readonly cache: LRUCache<Dependency[]>;
  private readonly symbolCache: LRUCache<{ symbols: SymbolInfo[]; dependencies: SymbolDependency[] }>;
  private readonly astWorkerHost: AstWorkerHost;
  private readonly reverseIndexStore: ReverseIndexStore;
  private readonly indexerStatus: IndexerStatus;
  private readonly sourceFileCollector: SourceFileCollector;

  private readonly dependencyAnalyzer: AnalyzerServices['dependencyAnalyzer'];
  private readonly referenceLookup: AnalyzerServices['referenceLookup'];
  private readonly symbolGraphReader: AnalyzerServices['symbolGraphReader'];
  private readonly deadCodeScanner: AnalyzerServices['deadCodeScanner'];
  private readonly usageVerifier: AnalyzerServices['usageVerifier'];
  private readonly dependencyCrawler: AnalyzerServices['dependencyCrawler'];
  private readonly indexingService: AnalyzerServices['indexingService'];
  private readonly cacheCoordinator: AnalyzerServices['cacheCoordinator'];

  /**
   * @internal Use {@link AnalyzerBuilder} instead.
   */
  constructor(services: AnalyzerServices) {
    this.config = services.config;
    this.resolver = services.resolver;
    this.cache = services.cache;
    this.symbolCache = services.symbolCache;
    this.astWorkerHost = services.astWorkerHost;
    this.reverseIndexStore = services.reverseIndexStore;
    this.indexerStatus = services.indexerStatus;
    this.sourceFileCollector = services.sourceFileCollector;
    this.dependencyAnalyzer = services.dependencyAnalyzer;
    this.referenceLookup = services.referenceLookup;
    this.symbolGraphReader = services.symbolGraphReader;
    this.deadCodeScanner = services.deadCodeScanner;
    this.usageVerifier = services.usageVerifier;
    this.dependencyCrawler = services.dependencyCrawler;
    this.indexingService = services.indexingService;
    this.cacheCoordinator = services.cacheCoordinator;
  }

  /** Stop the Analyzer and clean up resources. */
  async dispose(): Promise<void> {
    await this.astWorkerHost.stop();
  }

  updateConfig(config: Partial<AnalyzerConfig>): void {
    this.config.excludeNodeModules = config.excludeNodeModules ?? this.config.excludeNodeModules;
    this.config.maxDepth = config.maxDepth ?? this.config.maxDepth;

    if (config.excludeNodeModules !== undefined) {
      this.resolver.updateConfig(config.excludeNodeModules);
      this.sourceFileCollector.updateOptions({ excludeNodeModules: config.excludeNodeModules });
    }

    if (config.enableReverseIndex !== undefined) {
      this.config.enableReverseIndex = config.enableReverseIndex;
      if (config.enableReverseIndex) {
        this.reverseIndexStore.enable();
      } else {
        this.reverseIndexStore.disable();
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

  // ── Reverse index ──────────────────────────────────────────────────────

  enableReverseIndex(serializedData?: string): boolean {
    const restored = this.reverseIndexStore.enable(serializedData);
    this.config.enableReverseIndex = true;
    return restored;
  }

  disableReverseIndex(): void {
    this.config.enableReverseIndex = false;
    this.reverseIndexStore.disable();
  }

  getSerializedReverseIndex(): string | null {
    return this.reverseIndexStore.getSerialized();
  }

  async validateReverseIndex(staleThreshold = 0.2): Promise<{
    isValid: boolean;
    staleFiles: string[];
    stalePercentage: number;
    missingFiles: string[];
  } | null> {
    return this.reverseIndexStore.validate(staleThreshold);
  }

  getIndexStatus(): IndexerStatusSnapshot {
    return this.indexerStatus.getSnapshot();
  }

  subscribeToIndexStatus(callback: (snapshot: IndexerStatusSnapshot) => void): () => void {
    return this.indexerStatus.subscribe(callback);
  }

  hasReverseIndex(): boolean {
    return this.reverseIndexStore.hasEntries();
  }

  getCallerCount(targetPath: string): number {
    if (!this.reverseIndexStore.hasEntries()) {
      return 0;
    }
    return this.reverseIndexStore.getCallerCount(targetPath);
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

  // ── Graph crawl (downstream dependencies) ──────────────────────────────

  async crawl(
    startPath: string
  ): Promise<{ nodes: string[]; edges: { source: string; target: string }[]; nodeLabels?: Record<string, string> }> {
    return this.dependencyCrawler.crawl(startPath);
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
    return this.dependencyCrawler.crawlFrom(startNode, existingNodes, extraDepth, options);
  }

  async findReferencingFiles(targetPath: string): Promise<Dependency[]> {
    return this.referenceLookup.findReferencingFiles(targetPath);
  }

  /** Get files that reference a specific exported symbol. */
  getSymbolReferencingFiles(symbolId: string): Set<string> {
    if (!this.reverseIndexStore.hasEntries()) {
      return new Set();
    }
    const files = this.reverseIndexStore.getSymbolReferencingFiles(symbolId);
    return new Set(files);
  }

  // ── Symbol-level analysis ──────────────────────────────────────────────

  async getSymbolGraph(filePath: string): Promise<{
    symbols: SymbolInfo[];
    dependencies: SymbolDependency[];
  }> {
    return this.symbolGraphReader.getSymbolGraph(filePath);
  }

  async resolveModuleSpecifier(fromFilePath: string, moduleSpecifier: string): Promise<string | null> {
    return this.dependencyAnalyzer.resolveModuleSpecifier(fromFilePath, moduleSpecifier);
  }

  async findUnusedSymbols(filePath: string): Promise<SymbolInfo[]> {
    return this.deadCodeScanner.findUnusedSymbols(filePath);
  }

  async scanDeadCode(
    scopePath?: string,
    options?: { maxFiles?: number }
  ): Promise<{ entries: Array<{ filePath: string; unusedSymbols: SymbolInfo[] }>; scannedFiles: number; skippedFiles: number }> {
    const resolvedScope = scopePath ?? this.config.rootDir;
    return this.deadCodeScanner.scanDeadCode(resolvedScope, {
      maxFiles: options?.maxFiles,
      hasReverseIndex: this.hasReverseIndex(),
    });
  }

  async verifyDependencyUsage(sourceFile: string, targetFile: string): Promise<boolean> {
    return this.usageVerifier.verifyDependencyUsage(sourceFile, targetFile);
  }

  async verifyDependencyUsageBatch(sourceFile: string, targetFiles: string[]): Promise<Map<string, boolean>> {
    return this.usageVerifier.verifyDependencyUsageBatch(sourceFile, targetFiles);
  }

  async getSymbolDependents(filePath: string, symbolName: string): Promise<SymbolDependency[]> {
    return this.usageVerifier.getSymbolDependents(filePath, symbolName);
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
    return this.usageVerifier.traceFunctionExecution(filePath, symbolName, maxDepth);
  }

  // ── Cache stats ────────────────────────────────────────────────────────

  /** Get cache stats (synchronous; symbolAnalyzerFileCount may be 0 until worker queried). */
  getCacheStats(): {
    dependencyCache: ReturnType<LRUCache<Dependency[]>['getStats']>;
    symbolCache: ReturnType<LRUCache<{ symbols: SymbolInfo[]; dependencies: SymbolDependency[] }>['getStats']>;
    symbolAnalyzerFileCount: number;
    reverseIndexStats?: { indexedFiles: number; targetFiles: number; totalReferences: number };
  } {
    return {
      dependencyCache: this.cache.getStats(),
      symbolCache: this.symbolCache.getStats(),
      symbolAnalyzerFileCount: 0, // Use getCacheStatsAsync() for accurate count
      reverseIndexStats: this.reverseIndexStore.getStats(),
    };
  }

  /** Get cache stats with accurate AST worker file count (async). */
  async getCacheStatsAsync(): Promise<{
    dependencyCache: ReturnType<LRUCache<Dependency[]>['getStats']>;
    symbolCache: ReturnType<LRUCache<{ symbols: SymbolInfo[]; dependencies: SymbolDependency[] }>['getStats']>;
    symbolAnalyzerFileCount: number;
    reverseIndexStats?: { indexedFiles: number; targetFiles: number; totalReferences: number };
  }> {
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
      reverseIndexStats: this.reverseIndexStore.getStats(),
    };
  }
}

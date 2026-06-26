import { Analyzer } from './Analyzer';
import type { AnalyzerConfig } from '../domain/Config';
import type { Dependency } from '../domain/Dependency';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';
import { PathResolver } from '../resolution/PathResolver';
import { SourceFileCollector } from '../resolution/SourceFileCollector';
import { FileReader } from '../infra/FileReader';
import { LRUCache } from '../infra/LRUCache';
import { AstWorkerHost } from '../infra/AstWorkerHost';
import { LanguageService } from '../languages/LanguageService';
import { IndexerStatus } from '../indexing/IndexerStatus';
import { ReverseIndexStore } from '../indexing/ReverseIndexStore';
import { YIELD_INTERVAL_MS, yieldToEventLoop } from '../core/EventLoopYield';
import { SymbolDependencyHelper } from '../core/SymbolDependencyHelper';
import { DependencyAnalyzer } from '../services/DependencyAnalyzer';
import { SymbolGraphReader } from '../services/SymbolGraphReader';
import { DeadCodeScanner } from '../services/DeadCodeScanner';
import { UsageVerifier } from '../services/UsageVerifier';
import { ReferenceLookup } from '../services/ReferenceLookup';
import { ReferencingFilesFinder } from '../services/ReferencingFilesFinder';
import { DependencyCrawler } from '../services/DependencyCrawler';
import { IndexingService } from '../services/IndexingService';
import { CacheCoordinator } from '../services/CacheCoordinator';
import { WorkerManager } from '../services/WorkerManager';
import { Cancellation } from '../services/Cancellation';

/** Intra-file symbol graph payload shared between reader/scanner/verifier. */
type SymbolGraphPayload = { symbols: SymbolInfo[]; dependencies: SymbolDependency[] };

/**
 * Fully-initialized service bag handed to {@link Analyzer}'s constructor.
 * Composed by {@link createAnalyzerServices} in dependency order.
 *
 * @internal
 */
export interface AnalyzerServices {
  config: AnalyzerConfig;
  resolver: PathResolver;
  cache: LRUCache<Dependency[]>;
  symbolCache: LRUCache<SymbolGraphPayload>;
  astWorkerHost: AstWorkerHost;
  reverseIndexStore: ReverseIndexStore;
  indexerStatus: IndexerStatus;
  sourceFileCollector: SourceFileCollector;
  dependencyAnalyzer: DependencyAnalyzer;
  symbolGraphReader: SymbolGraphReader;
  deadCodeScanner: DeadCodeScanner;
  usageVerifier: UsageVerifier;
  referenceLookup: ReferenceLookup;
  dependencyCrawler: DependencyCrawler;
  indexingService: IndexingService;
  cacheCoordinator: CacheCoordinator;
}

/**
 * Construct all Analyzer services in the correct dependency order.
 *
 * Pure factory: given a finalized {@link AnalyzerConfig}, builds the services
 * across 5 phases and wires the `referenceLookup` ↔ `referencingFilesFinder`
 * circular dependency. Extracted so construction is independently testable.
 *
 * @param config - Fully resolved AnalyzerConfig (rootDir required).
 * @returns Fully initialized AnalyzerServices ready for `new Analyzer(services)`.
 * @internal
 */
export function createAnalyzerServices(config: AnalyzerConfig): AnalyzerServices {
  // Phase 1: Core services (no dependencies)
  const languageService = new LanguageService(config.rootDir, config.tsConfigPath, config.extensionPath);
  const resolver = new PathResolver(config.tsConfigPath, config.excludeNodeModules ?? true, config.rootDir);
  const cache = new LRUCache<Dependency[]>({ maxSize: config.maxCacheSize ?? 500, enableLRU: true });
  const symbolCache = new LRUCache<SymbolGraphPayload>({
    maxSize: config.maxSymbolCacheSize ?? 200,
    enableLRU: true,
  });
  const astWorkerHost = new AstWorkerHost(undefined, config.extensionPath);
  const reverseIndexStore = new ReverseIndexStore(config.rootDir);
  const fileReader = new FileReader();
  const indexerStatus = new IndexerStatus();
  const cancellation = new Cancellation();

  // Phase 2: Dependency services
  const workerManager = new WorkerManager(indexerStatus, reverseIndexStore, cache);
  const dependencyAnalyzer = new DependencyAnalyzer(languageService, resolver, cache, reverseIndexStore);
  const sourceFileCollector = new SourceFileCollector({
    excludeNodeModules: config.excludeNodeModules ?? true,
    yieldIntervalMs: YIELD_INTERVAL_MS,
    yieldCallback: () => yieldToEventLoop(),
    isCancelled: () => cancellation.isCancelled(),
  });

  // Phase 3: Lookup services (handle circular dependency)
  const referenceLookup = new ReferenceLookup(
    reverseIndexStore,
    dependencyAnalyzer,
    fileReader,
    () => indexerStatus.isReady(),
    () => indexerStatus.isActive(),
  );
  const referencingFilesFinder = new ReferencingFilesFinder({
    sourceFileCollector,
    getRootDir: () => config.rootDir,
    getConcurrency: () => config.indexingConcurrency ?? 4,
    findReferenceInFile: (filePath, normalizedTargetPath, targetBasename) =>
      referenceLookup.findReferenceInFile(filePath, normalizedTargetPath, targetBasename),
  });
  // Wire circular dependency
  referenceLookup.setFallbackFinder(referencingFilesFinder);

  // Phase 4: Analysis services (SpiderSymbolService is split into 3 here)
  const symbolDependencyHelper = new SymbolDependencyHelper({
    resolve: async (from, to) => {
      try {
        return await resolver.resolve(from, to);
      } catch {
        return null;
      }
    },
  });
  const symbolGraphReader = new SymbolGraphReader(
    astWorkerHost,
    symbolCache,
    fileReader,
    resolver,
    languageService,
    () => config,
  );
  const deadCodeScanner = new DeadCodeScanner(
    (filePath) => symbolGraphReader.getSymbolGraph(filePath),
    astWorkerHost,
    fileReader,
    (targetPath) => referenceLookup.findReferencingFiles(targetPath),
    symbolDependencyHelper,
    () => config,
  );
  const usageVerifier = new UsageVerifier(
    (filePath) => symbolGraphReader.getSymbolGraph(filePath),
    resolver,
    symbolDependencyHelper,
    (targetPath) => referenceLookup.findReferencingFiles(targetPath),
  );
  const dependencyCrawler = new DependencyCrawler(dependencyAnalyzer, () => config);
  const indexingService = new IndexingService(
    dependencyAnalyzer,
    cache,
    reverseIndexStore,
    sourceFileCollector,
    indexerStatus,
    workerManager,
    cancellation,
    () => config,
    () => yieldToEventLoop(),
    (filePath) => symbolGraphReader.getSymbolGraph(filePath),
  );

  // Phase 5: Coordinator
  const cacheCoordinator = new CacheCoordinator(cache, symbolCache, reverseIndexStore);

  // Enable reverse index if configured
  if (config.enableReverseIndex) {
    reverseIndexStore.enable();
  }

  return {
    config,
    resolver,
    cache,
    symbolCache,
    astWorkerHost,
    reverseIndexStore,
    indexerStatus,
    sourceFileCollector,
    dependencyAnalyzer,
    symbolGraphReader,
    deadCodeScanner,
    usageVerifier,
    referenceLookup,
    dependencyCrawler,
    indexingService,
    cacheCoordinator,
  };
}

/**
 * Builder for constructing {@link Analyzer} instances with a fluent API.
 *
 * Provides a type-safe, progressive configuration approach. Handles complex
 * service initialization, dependency ordering, and circular dependencies
 * automatically via {@link createAnalyzerServices}.
 *
 * @module dependon/facade
 */
export class AnalyzerBuilder {
  private rootDir?: string;
  private tsConfigPath?: string;
  private extensionPath?: string;
  private maxDepth: number = 50;
  private excludeNodeModules: boolean = true;
  private enableReverseIndex: boolean = false;
  private indexingConcurrency: number = 4;
  private maxCacheSize: number = 500;
  private maxSymbolCacheSize: number = 200;
  private maxSymbolAnalyzerFiles: number = 100;
  private indexingProgressInterval?: number;

  withRootDir(rootDir: string): this {
    this.rootDir = rootDir;
    return this;
  }

  withTsConfigPath(tsConfigPath: string): this {
    this.tsConfigPath = tsConfigPath;
    return this;
  }

  withExtensionPath(extensionPath: string): this {
    this.extensionPath = extensionPath;
    return this;
  }

  withMaxDepth(maxDepth: number): this {
    this.maxDepth = maxDepth;
    return this;
  }

  withExcludeNodeModules(exclude: boolean): this {
    this.excludeNodeModules = exclude;
    return this;
  }

  withReverseIndex(enabled: boolean): this {
    this.enableReverseIndex = enabled;
    return this;
  }

  withIndexingConcurrency(concurrency: number): this {
    this.indexingConcurrency = concurrency;
    return this;
  }

  withCacheConfig(config: {
    maxCacheSize?: number;
    maxSymbolCacheSize?: number;
    maxSymbolAnalyzerFiles?: number;
  }): this {
    if (config.maxCacheSize !== undefined) this.maxCacheSize = config.maxCacheSize;
    if (config.maxSymbolCacheSize !== undefined) this.maxSymbolCacheSize = config.maxSymbolCacheSize;
    if (config.maxSymbolAnalyzerFiles !== undefined) this.maxSymbolAnalyzerFiles = config.maxSymbolAnalyzerFiles;
    return this;
  }

  withIndexingProgressInterval(interval: number): this {
    this.indexingProgressInterval = interval;
    return this;
  }

  withConfig(config: AnalyzerConfig): this {
    this.rootDir = config.rootDir;
    if (config.tsConfigPath !== undefined) this.tsConfigPath = config.tsConfigPath;
    if (config.extensionPath !== undefined) this.extensionPath = config.extensionPath;
    if (config.maxDepth !== undefined) this.maxDepth = config.maxDepth;
    if (config.excludeNodeModules !== undefined) this.excludeNodeModules = config.excludeNodeModules;
    if (config.enableReverseIndex !== undefined) this.enableReverseIndex = config.enableReverseIndex;
    if (config.indexingConcurrency !== undefined) this.indexingConcurrency = config.indexingConcurrency;
    if (config.maxCacheSize !== undefined) this.maxCacheSize = config.maxCacheSize;
    if (config.maxSymbolCacheSize !== undefined) this.maxSymbolCacheSize = config.maxSymbolCacheSize;
    if (config.maxSymbolAnalyzerFiles !== undefined) this.maxSymbolAnalyzerFiles = config.maxSymbolAnalyzerFiles;
    if (config.indexingProgressInterval !== undefined) this.indexingProgressInterval = config.indexingProgressInterval;
    return this;
  }

  /** Build and return the Analyzer instance. */
  build(): Analyzer {
    this.validate();
    const services = createAnalyzerServices(this.buildConfig());
    return new Analyzer(services);
  }

  private validate(): void {
    if (!this.rootDir) {
      throw new Error('rootDir is required');
    }
    if (this.maxDepth < 0) {
      throw new Error('maxDepth must be non-negative');
    }
    if (this.indexingConcurrency < 1) {
      throw new Error('indexingConcurrency must be at least 1');
    }
    if (this.maxCacheSize < 0) {
      throw new Error('maxCacheSize must be non-negative');
    }
    if (this.maxSymbolCacheSize < 0) {
      throw new Error('maxSymbolCacheSize must be non-negative');
    }
    if (this.maxSymbolAnalyzerFiles < 0) {
      throw new Error('maxSymbolAnalyzerFiles must be non-negative');
    }
  }

  private buildConfig(): AnalyzerConfig {
    return {
      rootDir: this.rootDir!,
      tsConfigPath: this.tsConfigPath,
      extensionPath: this.extensionPath,
      maxDepth: this.maxDepth,
      excludeNodeModules: this.excludeNodeModules,
      enableReverseIndex: this.enableReverseIndex,
      indexingConcurrency: this.indexingConcurrency,
      maxCacheSize: this.maxCacheSize,
      maxSymbolCacheSize: this.maxSymbolCacheSize,
      maxSymbolAnalyzerFiles: this.maxSymbolAnalyzerFiles,
      indexingProgressInterval: this.indexingProgressInterval,
    };
  }
}

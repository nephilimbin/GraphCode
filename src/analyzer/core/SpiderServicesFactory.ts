import { AstWorkerHost } from '../ast/AstWorkerHost';
import { Cache } from '../indexing/Cache';
import { FileReader } from '../source/FileReader';
import { IndexerStatus } from '../indexing/IndexerStatus';
import { LanguageService } from '../source/LanguageService';
import { PathResolver } from '../source/PathResolver';
import { ReferencingFilesFinder } from '../source/ReferencingFilesFinder';
import { ReverseIndexManager } from '../indexing/ReverseIndexManager';
import { SourceFileCollector } from '../source/SourceFileCollector';
import { SpiderCacheCoordinator } from './spider/SpiderCacheCoordinator';
import { SpiderDependencyAnalyzer } from './spider/SpiderDependencyAnalyzer';
import { SpiderGraphCrawler } from './spider/SpiderGraphCrawler';
import { SpiderIndexingCancellation } from './spider/SpiderIndexingCancellation';
import { SpiderIndexingService } from './spider/SpiderIndexingService';
import { SpiderReferenceLookup } from './spider/SpiderReferenceLookup';
import { SpiderSymbolService } from './spider/SpiderSymbolService';
import { SpiderWorkerManager } from './spider/SpiderWorkerManager';
import { SymbolDependencyHelper } from '../symbol/SymbolDependencyHelper';
import type { Dependency, SpiderConfig, SymbolDependency, SymbolInfo } from '../foundation/types';
import { YIELD_INTERVAL_MS, yieldToEventLoop } from '../utils/eventLoopYield';
import type { SpiderServices } from './SpiderServices';

/**
 * Construct all Spider services in the correct dependency order.
 *
 * Pure factory: given a finalized {@link SpiderConfig}, builds the 18 services
 * across 5 phases and wires the `referenceLookup` ↔ `referencingFilesFinder`
 * circular dependency. Extracted from {@link SpiderBuilder} so the builder stays
 * a pure configuration collector while service construction is independently testable.
 *
 * @param config - Fully resolved SpiderConfig (rootDir required).
 * @returns Fully initialized SpiderServices ready for `new Spider(services)`.
 *
 * @internal
 */
export function createSpiderServices(config: SpiderConfig): SpiderServices {
  // Phase 1: Core services (no dependencies)
  const languageService = new LanguageService(config.rootDir, config.tsConfigPath, config.extensionPath);
  const resolver = new PathResolver(config.tsConfigPath, config.excludeNodeModules, config.rootDir);
  const cache = new Cache<Dependency[]>({ maxSize: config.maxCacheSize, enableLRU: true });
  const symbolCache = new Cache<{ symbols: SymbolInfo[]; dependencies: SymbolDependency[] }>({
    maxSize: config.maxSymbolCacheSize,
    enableLRU: true,
  });
  const astWorkerHost = new AstWorkerHost(undefined, config.extensionPath);
  const reverseIndexManager = new ReverseIndexManager(config.rootDir);
  const fileReader = new FileReader();
  const indexerStatus = new IndexerStatus();
  const cancellation = new SpiderIndexingCancellation();

  // Phase 2: Dependency services
  const workerManager = new SpiderWorkerManager(indexerStatus, reverseIndexManager, cache);
  const dependencyAnalyzer = new SpiderDependencyAnalyzer(
    languageService,
    resolver,
    cache,
    reverseIndexManager,
  );
  const sourceFileCollector = new SourceFileCollector({
    excludeNodeModules: config.excludeNodeModules ?? true,
    yieldIntervalMs: YIELD_INTERVAL_MS,
    yieldCallback: () => yieldToEventLoop(),
    isCancelled: () => cancellation.isCancelled(),
  });

  // Phase 3: Lookup services (handle circular dependency)
  const referenceLookup = new SpiderReferenceLookup(
    reverseIndexManager,
    dependencyAnalyzer,
    fileReader,
    () => indexerStatus.isReady(),
    () => indexerStatus.isActive(),
  );
  const referencingFilesFinder = new ReferencingFilesFinder({
    sourceFileCollector,
    getRootDir: () => config.rootDir,
    getConcurrency: () => config.indexingConcurrency,
    findReferenceInFile: (filePath, normalizedTargetPath, targetBasename) =>
      referenceLookup.findReferenceInFile(filePath, normalizedTargetPath, targetBasename),
  });
  // Wire circular dependency
  referenceLookup.setFallbackFinder(referencingFilesFinder);

  // Phase 4: Analysis services
  const symbolDependencyHelper = new SymbolDependencyHelper({
    resolve: async (from, to) => {
      try {
        return await resolver.resolve(from, to);
      } catch {
        return null;
      }
    },
  });
  const symbolService = new SpiderSymbolService(
    astWorkerHost,
    symbolCache,
    fileReader,
    resolver,
    symbolDependencyHelper,
    () => config,
    (targetPath) => referenceLookup.findReferencingFiles(targetPath),
    languageService,
  );
  const graphCrawler = new SpiderGraphCrawler(dependencyAnalyzer, () => config);
  const indexingService = new SpiderIndexingService(
    dependencyAnalyzer,
    cache,
    reverseIndexManager,
    sourceFileCollector,
    indexerStatus,
    workerManager,
    cancellation,
    () => config,
    () => yieldToEventLoop(),
    (filePath) => symbolService.getSymbolGraph(filePath),
  );

  // Phase 5: Coordinator
  const cacheCoordinator = new SpiderCacheCoordinator(cache, symbolCache, reverseIndexManager);

  // Enable reverse index if configured
  if (config.enableReverseIndex) {
    reverseIndexManager.enable();
  }

  return {
    config,
    languageService,
    resolver,
    cache,
    symbolCache,
    fileReader,
    astWorkerHost,
    reverseIndexManager,
    indexerStatus,
    workerManager,
    cancellation,
    sourceFileCollector,
    referencingFilesFinder,
    symbolDependencyHelper,
    dependencyAnalyzer,
    referenceLookup,
    symbolService,
    graphCrawler,
    indexingService,
    cacheCoordinator,
  };
}

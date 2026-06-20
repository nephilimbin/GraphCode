import type { AstWorkerHost } from "../ast/AstWorkerHost";
import type { Cache } from "../indexing/Cache";
import type { IndexerStatus } from "../indexing/IndexerStatus";
import type { ReverseIndexManager } from "../indexing/ReverseIndexManager";
import type { FileReader } from "../source/FileReader";
import type { LanguageService } from "../source/LanguageService";
import type { PathResolver } from "../source/PathResolver";
import type { ReferencingFilesFinder } from "../source/ReferencingFilesFinder";
import type { SourceFileCollector } from "../source/SourceFileCollector";
import type { SymbolDependencyHelper } from "../symbol/SymbolDependencyHelper";
import type {
  Dependency,
  SpiderConfig,
  SymbolDependency,
  SymbolInfo,
} from "../foundation/types";
import type { SpiderCacheCoordinator } from "./spider/SpiderCacheCoordinator";
import type { SpiderDependencyAnalyzer } from "./spider/SpiderDependencyAnalyzer";
import type { SpiderGraphCrawler } from "./spider/SpiderGraphCrawler";
import type { SpiderIndexingCancellation } from "./spider/SpiderIndexingCancellation";
import type { SpiderIndexingService } from "./spider/SpiderIndexingService";
import type { SpiderReferenceLookup } from "./spider/SpiderReferenceLookup";
import type { SpiderSymbolService } from "./spider/SpiderSymbolService";
import type { SpiderWorkerManager } from "./spider/SpiderWorkerManager";

/**
 * Internal interface defining all services required by Spider.
 * This interface is used by SpiderBuilder to pass fully initialized services to Spider's constructor.
 *
 * @internal
 */
export interface SpiderServices {
  /** Spider configuration object */
  config: SpiderConfig;

  /** Language service for TypeScript/JavaScript analysis */
  languageService: LanguageService;

  /** Path resolver for module resolution */
  resolver: PathResolver;

  /** Cache for dependency analysis results */
  cache: Cache<Dependency[]>;

  /** Cache for symbol analysis results */
  symbolCache: Cache<{
    symbols: SymbolInfo[];
    dependencies: SymbolDependency[];
  }>;

  /** File reader utility */
  fileReader: FileReader;

  /** AST worker host for isolated ts-morph operations */
  astWorkerHost: AstWorkerHost;

  /** Reverse index manager for O(1) reverse dependency lookups */
  reverseIndexManager: ReverseIndexManager;

  /** Indexer status tracker */
  indexerStatus: IndexerStatus;

  /** Worker manager for background indexing */
  workerManager: SpiderWorkerManager;

  /** Cancellation token for indexing operations */
  cancellation: SpiderIndexingCancellation;

  /** Source file collector for finding project files */
  sourceFileCollector: SourceFileCollector;

  /** Finder for files that reference a target file */
  referencingFilesFinder: ReferencingFilesFinder;

  /** Helper for resolving symbol dependencies */
  symbolDependencyHelper: SymbolDependencyHelper;

  /** Core dependency analyzer */
  dependencyAnalyzer: SpiderDependencyAnalyzer;

  /** Reference lookup service (handles circular dependency with referencingFilesFinder) */
  referenceLookup: SpiderReferenceLookup;

  /** Symbol analysis service */
  symbolService: SpiderSymbolService;

  /** Graph crawler for dependency graph traversal */
  graphCrawler: SpiderGraphCrawler;

  /** Indexing service for background analysis */
  indexingService: SpiderIndexingService;

  /** Cache coordinator for managing all caches */
  cacheCoordinator: SpiderCacheCoordinator;
}

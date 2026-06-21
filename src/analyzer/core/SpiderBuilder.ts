import { Spider } from './Spider';
import { createSpiderServices } from './SpiderServicesFactory';
import type { SpiderConfig } from '../foundation/types';

/**
 * Builder for constructing Spider instances with a fluent API.
 * 
 * SpiderBuilder provides a type-safe, progressive configuration approach for creating Spider instances.
 * It handles complex service initialization, dependency ordering, and circular dependencies automatically.
 * 
 * ## Configuration Options
 * 
 * ### Required
 * - `rootDir` - Project root directory (must be set via `withRootDir()`)
 * 
 * ### Optional (with defaults)
 * - `maxDepth` - Maximum crawl depth (default: 50)
 * - `excludeNodeModules` - Exclude node_modules from analysis (default: true)
 * - `enableReverseIndex` - Enable O(1) reverse dependency lookups (default: false)
 * - `indexingConcurrency` - Number of parallel indexing workers (default: 4)
 * - `maxCacheSize` - Dependency cache size (default: 500)
 * - `maxSymbolCacheSize` - Symbol cache size (default: 200)
 * - `maxSymbolAnalyzerFiles` - Symbol analyzer file limit (default: 100)
 * - `tsConfigPath` - Path to tsconfig.json (optional)
 * - `indexingProgressInterval` - Progress callback interval in ms (optional)
 * 
 * ## Basic Usage
 * 
 * @example Minimal configuration
 * ```typescript
 * import { SpiderBuilder } from './SpiderBuilder';
 * 
 * // Only rootDir is required - all other options use sensible defaults
 * const spider = new SpiderBuilder()
 *   .withRootDir('/path/to/project')
 *   .build();
 * 
 * // Analyze a file
 * const dependencies = await spider.analyze('src/index.ts');
 * 
 * // Clean up when done
 * await spider.dispose();
 * ```
 * 
 * @see {@link Spider} for the main analyzer class
 * @see {@link SpiderConfig} for configuration options
 */
export class SpiderBuilder {
  // Configuration state
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

  /**
   * Set the root directory (required).
   * 
   * This is the only required configuration option. All file paths will be resolved relative to this directory.
   * 
   * @param rootDir - Absolute path to the project root directory
   * @returns This builder instance for method chaining
   */
  withRootDir(rootDir: string): this {
    this.rootDir = rootDir;
    return this;
  }

  /**
   * Set the TypeScript config path (optional).
   * 
   * If provided, Spider will use this tsconfig.json for module resolution and path mapping.
   * If not provided, Spider will attempt to find tsconfig.json in the root directory.
   * 
   * @param tsConfigPath - Path to tsconfig.json (absolute or relative to rootDir)
   * @returns This builder instance for method chaining
   */
  withTsConfigPath(tsConfigPath: string): this {
    this.tsConfigPath = tsConfigPath;
    return this;
  }

  /**
   * Set the extension path (optional, required for WASM parsers).
   * 
   * The extension path is used to locate WASM files for Python and Rust parsers.
   * This should be the VS Code extension's installation directory (context.extensionPath).
   * 
   * @param extensionPath - Absolute path to the extension directory
   * @returns This builder instance for method chaining
   */
  withExtensionPath(extensionPath: string): this {
    this.extensionPath = extensionPath;
    return this;
  }

  /**
   * Set maximum crawl depth (default: 50).
   * 
   * Controls how deep the dependency graph traversal will go. Higher values allow deeper analysis
   * but may impact performance on large projects.
   * 
   * @param maxDepth - Maximum depth for graph traversal (must be non-negative)
   * @returns This builder instance for method chaining
   */
  withMaxDepth(maxDepth: number): this {
    this.maxDepth = maxDepth;
    return this;
  }

  /**
   * Set whether to exclude node_modules (default: true).
   * 
   * When true, files in node_modules directories are excluded from analysis.
   * Set to false if you need to analyze dependencies within node_modules.
   * 
   * @param exclude - Whether to exclude node_modules from analysis
   * @returns This builder instance for method chaining
   */
  withExcludeNodeModules(exclude: boolean): this {
    this.excludeNodeModules = exclude;
    return this;
  }

  /**
   * Enable or disable reverse index (default: false).
   * 
   * When enabled, Spider maintains an O(1) reverse index for finding files that reference a target file.
   * This enables fast "find references" operations but uses additional memory.
   * 
   * @param enabled - Whether to enable reverse index
   * @returns This builder instance for method chaining
   */
  withReverseIndex(enabled: boolean): this {
    this.enableReverseIndex = enabled;
    return this;
  }

  /**
   * Set indexing concurrency (default: 4).
   * 
   * Controls how many files are analyzed in parallel during background indexing.
   * Higher values improve indexing speed but use more CPU and memory.
   * 
   * @param concurrency - Number of parallel workers (must be at least 1)
   * @returns This builder instance for method chaining
   */
  withIndexingConcurrency(concurrency: number): this {
    this.indexingConcurrency = concurrency;
    return this;
  }

  /**
   * Set cache configuration.
   * 
   * Controls the size of various caches used by Spider. Larger caches improve performance
   * but use more memory. Adjust based on your project size and available resources.
   * 
   * @param config - Cache configuration options
   * @param config.maxCacheSize - Dependency cache size (default: 500)
   * @param config.maxSymbolCacheSize - Symbol cache size (default: 200)
   * @param config.maxSymbolAnalyzerFiles - Symbol analyzer file limit (default: 100)
   * @returns This builder instance for method chaining
   */
  withCacheConfig(config: {
    maxCacheSize?: number;
    maxSymbolCacheSize?: number;
    maxSymbolAnalyzerFiles?: number;
  }): this {
    if (config.maxCacheSize !== undefined) {
      this.maxCacheSize = config.maxCacheSize;
    }
    if (config.maxSymbolCacheSize !== undefined) {
      this.maxSymbolCacheSize = config.maxSymbolCacheSize;
    }
    if (config.maxSymbolAnalyzerFiles !== undefined) {
      this.maxSymbolAnalyzerFiles = config.maxSymbolAnalyzerFiles;
    }
    return this;
  }

  /**
   * Set indexing progress interval (optional).
   * 
   * Controls how often progress callbacks are invoked during indexing operations.
   * Lower values provide more frequent updates but may impact performance.
   * 
   * @param interval - Progress callback interval in milliseconds
   * @returns This builder instance for method chaining
   */
  withIndexingProgressInterval(interval: number): this {
    this.indexingProgressInterval = interval;
    return this;
  }

  /**
   * Bulk configuration from SpiderConfig.
   * 
   * Allows setting multiple configuration options at once from a SpiderConfig object.
   * Individual options can still be overridden by calling specific `with*` methods after this.
   * 
   * @param config - SpiderConfig object with configuration options
   * @returns This builder instance for method chaining
   */
  withConfig(config: SpiderConfig): this {
    this.rootDir = config.rootDir;
    if (config.tsConfigPath !== undefined) {
      this.tsConfigPath = config.tsConfigPath;
    }
    if (config.extensionPath !== undefined) {
      this.extensionPath = config.extensionPath;
    }
    if (config.maxDepth !== undefined) {
      this.maxDepth = config.maxDepth;
    }
    if (config.excludeNodeModules !== undefined) {
      this.excludeNodeModules = config.excludeNodeModules;
    }
    if (config.enableReverseIndex !== undefined) {
      this.enableReverseIndex = config.enableReverseIndex;
    }
    if (config.indexingConcurrency !== undefined) {
      this.indexingConcurrency = config.indexingConcurrency;
    }
    if (config.maxCacheSize !== undefined) {
      this.maxCacheSize = config.maxCacheSize;
    }
    if (config.maxSymbolCacheSize !== undefined) {
      this.maxSymbolCacheSize = config.maxSymbolCacheSize;
    }
    if (config.maxSymbolAnalyzerFiles !== undefined) {
      this.maxSymbolAnalyzerFiles = config.maxSymbolAnalyzerFiles;
    }
    if (config.indexingProgressInterval !== undefined) {
      this.indexingProgressInterval = config.indexingProgressInterval;
    }
    return this;
  }

  /**
   * Build and return the Spider instance.
   * 
   * Validates configuration, initializes all services in the correct dependency order,
   * and constructs a fully initialized Spider instance.
   * 
   * @returns Fully initialized Spider instance
   * @throws Error if required configuration is missing (rootDir)
   * @throws Error if configuration values are invalid (negative depths, etc.)
   */
  build(): Spider {
    this.validate();
    const services = createSpiderServices(this.buildConfig());
    return new Spider(services);
  }

  /**
   * Validate configuration before building
   * @private
   */
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

  /**
   * Build SpiderConfig from current state
   * @private
   */
  private buildConfig(): SpiderConfig {
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

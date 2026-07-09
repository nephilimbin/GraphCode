import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizePath } from "../foundation/types";
import { getLogger } from "../foundation/logger";
import { parseJsonc } from "../utils/parseJsonc";
import { isPackageJsonAliasCandidate } from "../utils/pathPredicates";
import { fileExists, shouldStopSearch } from "./fileResolve";

const log = getLogger("TsConfigResolver");

/** Minimal structural type for the tsconfig fields we read (extends / baseUrl / paths). */
type TsConfigJson = {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
};

/**
 * TypeScript `tsconfig.json` path-alias resolution.
 *
 * Two layers:
 * 1. Static aliases from the constructor-supplied tsconfig (loaded once into
 *    `pathAliases`).
 * 2. Dynamic discovery of the nearest tsconfig per source file (with directory
 *    + file level caching, "extends" chain following, and concurrent-load
 *    deduplication).
 */
export class TsConfigResolver {
  private readonly pathAliases: Map<string, string> = new Map();
  private tsConfigPromise?: Promise<void>;
  private readonly tsConfigPath?: string;
  private isConfigLoaded = false;

  // Cache: directory path -> nearest tsconfig.json path (or null if none found)
  private readonly directoryToTsConfig: Map<string, string | null> = new Map();

  // Cache: tsconfig.json path -> parsed path aliases map (alias -> target path)
  private readonly tsConfigPathAliases: Map<string, Map<string, string>> =
    new Map();

  // Promises for loading tsconfig.json files (to avoid concurrent loads)
  private readonly tsConfigLoadPromises: Map<
    string,
    Promise<Map<string, string>>
  > = new Map();

  private readonly workspaceRoot?: string;

  constructor(tsConfigPath?: string, workspaceRoot?: string) {
    this.tsConfigPath = tsConfigPath;
    this.workspaceRoot = workspaceRoot;
  }

  /** Ensure the static tsconfig (if provided) is loaded before resolving. */
  async ensureTsConfigLoaded(): Promise<void> {
    if (this.isConfigLoaded || !this.tsConfigPath) {
      return;
    }

    this.tsConfigPromise ??= this.loadTsConfig(this.tsConfigPath);

    await this.tsConfigPromise;
    this.tsConfigPromise = undefined;
    this.isConfigLoaded = true;
  }

  /** Load path aliases from the constructor-supplied tsconfig.json */
  private async loadTsConfig(tsConfigPath: string): Promise<void> {
    try {
      // 容错：tsConfigPath 可能被误传为目录(如项目根目录)。若是目录则尝试拼 tsconfig.json；
      // 若最终不是普通文件则静默跳过(tsconfig 可选，不应抛 EISDIR 打扰日志)。
      let resolvedPath = tsConfigPath;
      let stats = await fs.stat(tsConfigPath).catch(() => null);
      if (stats?.isDirectory()) {
        resolvedPath = path.join(tsConfigPath, "tsconfig.json");
        stats = await fs.stat(resolvedPath).catch(() => null);
      }
      if (!stats?.isFile()) {
        return;
      }

      const content = await fs.readFile(resolvedPath, "utf-8");
      const tsConfig = parseJsonc<TsConfigJson>(content);

      const paths = tsConfig?.compilerOptions?.paths;
      const baseUrl = tsConfig?.compilerOptions?.baseUrl || ".";

      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          // Remove trailing /* from alias
          const cleanAlias = alias.replace(/\/\*$/, "");

          // Get first target and remove trailing /*
          const target = (targets as string[])[0]?.replace(/\/\*$/, "");

          if (target) {
            // Resolve relative to tsconfig directory
            const tsConfigDir = path.dirname(resolvedPath);
            const absoluteTarget = path.resolve(tsConfigDir, baseUrl, target);
            this.pathAliases.set(cleanAlias, normalizePath(absoluteTarget));
          }
        }
      }
    } catch (error) {
      // tsconfig is optional, but a parse failure silently disables path-alias
      // resolution (e.g. a comment-bearing tsconfig that JSON.parse rejects).
      // Surface it so a broken alias config is debuggable instead of invisible.
      log.warn(`Failed to parse tsconfig "${tsConfigPath}": ${String(error)}`);
    }
  }

  /** Resolve a static alias from the constructor-supplied tsconfig */
  resolveAlias(modulePath: string): string | null {
    for (const [alias, target] of this.pathAliases.entries()) {
      if (modulePath === alias || modulePath.startsWith(alias + "/")) {
        // Replace alias with target path
        const resolved = modulePath.replace(alias, target);
        return resolved;
      }
    }
    return null;
  }

  /** Resolve an alias using the nearest tsconfig.json (dynamic discovery) */
  async resolveDynamicTsConfigAlias(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Only try for potential aliases (starts with @ or other non-relative patterns)
    if (!isPackageJsonAliasCandidate(modulePath)) {
      return null;
    }

    const tsConfigPath = await this.findNearestTsConfig(currentFilePath);
    if (!tsConfigPath) {
      return null;
    }

    const aliases = await this.getTsConfigPathAliases(tsConfigPath);

    for (const [alias, target] of aliases.entries()) {
      if (modulePath === alias || modulePath.startsWith(alias + "/")) {
        const resolved = modulePath.replace(alias, target);
        return normalizePath(resolved);
      }
    }

    return null;
  }

  /**
   * Find the nearest tsconfig.json by traversing up from the file's directory.
   * Stops at workspaceRoot.
   */
  private async findNearestTsConfig(filePath: string): Promise<string | null> {
    const startDir = path.dirname(filePath);

    // Check cache first for this directory
    if (this.directoryToTsConfig.has(startDir)) {
      return this.directoryToTsConfig.get(startDir) ?? null;
    }

    const result = await this.searchTsConfigUpward(startDir);
    return result;
  }

  /**
   * Search for tsconfig.json by traversing up directories.
   * Caches results for all checked directories.
   */
  private async searchTsConfigUpward(startDir: string): Promise<string | null> {
    const checkedDirs: string[] = [];
    let currentDir = startDir;

    while (!shouldStopSearch(this.workspaceRoot, currentDir)) {
      checkedDirs.push(currentDir);

      // Check if we already know the result for this directory
      const cachedResult = this.directoryToTsConfig.get(currentDir);
      if (cachedResult !== undefined) {
        this.cacheTsConfigResultForDirs(checkedDirs, cachedResult);
        return cachedResult;
      }

      const tsConfigPath = path.join(currentDir, "tsconfig.json");
      const exists = await fileExists(tsConfigPath);
      if (exists) {
        this.cacheTsConfigResultForDirs(checkedDirs, tsConfigPath);
        return tsConfigPath;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached filesystem root
      }
      currentDir = parentDir;
    }

    // No tsconfig.json found
    this.cacheTsConfigResultForDirs(checkedDirs, null);
    return null;
  }

  /** Cache the tsconfig.json result for all checked directories */
  private cacheTsConfigResultForDirs(
    dirs: string[],
    result: string | null,
  ): void {
    for (const dir of dirs) {
      this.directoryToTsConfig.set(dir, result);
    }
  }

  /** Get parsed path aliases from a tsconfig.json file (cached) */
  private async getTsConfigPathAliases(
    tsConfigPath: string,
  ): Promise<Map<string, string>> {
    // Return from cache if already loaded
    const cachedAliases = this.tsConfigPathAliases.get(tsConfigPath);
    if (cachedAliases !== undefined) {
      return cachedAliases;
    }

    // Check if already loading
    const loadingAliasPromise = this.tsConfigLoadPromises.get(tsConfigPath);
    if (loadingAliasPromise !== undefined) {
      return loadingAliasPromise;
    }

    // Start loading and cache the promise
    const loadPromise = this.loadTsConfigPathAliases(tsConfigPath);
    this.tsConfigLoadPromises.set(tsConfigPath, loadPromise);

    try {
      const aliases = await loadPromise;
      this.tsConfigPathAliases.set(tsConfigPath, aliases);
      return aliases;
    } finally {
      this.tsConfigLoadPromises.delete(tsConfigPath);
    }
  }

  /**
   * Load and parse path aliases from a tsconfig.json file.
   * Follows the "extends" chain to inherit aliases from parent configs.
   */
  private async loadTsConfigPathAliases(
    tsConfigPath: string,
  ): Promise<Map<string, string>> {
    const aliases = new Map<string, string>();
    const visited = new Set<string>();

    await this.loadTsConfigPathAliasesRecursive(tsConfigPath, aliases, visited);

    return aliases;
  }

  /** Recursively load path aliases, following "extends" chain */
  private async loadTsConfigPathAliasesRecursive(
    tsConfigPath: string,
    aliases: Map<string, string>,
    visited: Set<string>,
  ): Promise<void> {
    // Prevent infinite loops
    const normalizedPath = path.resolve(tsConfigPath);
    if (visited.has(normalizedPath)) {
      return;
    }
    visited.add(normalizedPath);

    try {
      const content = await fs.readFile(tsConfigPath, "utf-8");
      const tsConfig = parseJsonc<TsConfigJson>(content);
      const tsConfigDir = path.dirname(tsConfigPath);

      // First, process "extends" to get parent aliases (they have lower priority)
      if (tsConfig.extends) {
        const extendsPath = path.resolve(tsConfigDir, tsConfig.extends);
        // Try with .json extension if not present
        const parentPath = extendsPath.endsWith(".json")
          ? extendsPath
          : extendsPath + ".json";
        const actualParentPath = (await fileExists(parentPath))
          ? parentPath
          : extendsPath;

        if (await fileExists(actualParentPath)) {
          await this.loadTsConfigPathAliasesRecursive(
            actualParentPath,
            aliases,
            visited,
          );
        }
      }

      // Then, process this config's paths (they override parent aliases)
      const paths = tsConfig?.compilerOptions?.paths;
      const baseUrl = tsConfig?.compilerOptions?.baseUrl || ".";

      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          // Remove trailing /* from alias
          const cleanAlias = alias.replace(/\/\*$/, "");

          // Get first target and remove trailing /*
          const target = (targets as string[])[0]?.replace(/\/\*$/, "");

          if (target) {
            // Resolve relative to this tsconfig's directory
            const absoluteTarget = path.resolve(tsConfigDir, baseUrl, target);
            aliases.set(cleanAlias, normalizePath(absoluteTarget));
          }
        }
      }
    } catch (error) {
      // tsconfig is optional, but a parse failure silently disables path-alias
      // resolution (e.g. a comment-bearing tsconfig that JSON.parse rejects).
      // Surface it so a broken alias config is debuggable instead of invisible.
      log.warn(`Failed to parse tsconfig "${tsConfigPath}": ${String(error)}`);
    }
  }
}

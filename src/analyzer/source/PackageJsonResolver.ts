import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizePath } from "../foundation/types";
import { fileExists, shouldStopSearch } from "./fileResolve";

/**
 * package.json `imports` / `aliases` field resolution.
 *
 * Resolves Node.js subpath imports (`#internal/...`) and `@alias` patterns by
 * discovering the nearest package.json and reading its imports/aliases fields.
 * Caches results at both the directory level (nearest package.json) and the
 * file level (parsed imports map), with concurrent-load deduplication.
 */
export class PackageJsonResolver {
  // Cache: directory path -> nearest package.json path (or null if none found)
  private readonly directoryToPackageJson: Map<string, string | null> =
    new Map();

  // Cache: package.json path -> parsed imports map (alias -> target path)
  private readonly packageJsonImports: Map<string, Map<string, string>> =
    new Map();

  // Promises for loading package.json files (to avoid concurrent loads)
  private readonly packageJsonLoadPromises: Map<
    string,
    Promise<Map<string, string>>
  > = new Map();

  private readonly workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Resolve an import via the nearest package.json imports field.
   * Supports both #imports and @alias imports.
   */
  async resolvePackageJsonImport(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    const packageJsonPath = await this.findNearestPackageJson(currentFilePath);
    if (!packageJsonPath) {
      return null;
    }

    const imports = await this.getPackageJsonImports(packageJsonPath);
    const packageDir = path.dirname(packageJsonPath);

    // Try exact match first
    const target = imports.get(modulePath);
    if (target !== undefined) {
      return normalizePath(path.resolve(packageDir, target));
    }

    // Try wildcard match (e.g., #internal/* -> ./src/internal/*)
    for (const [alias, target] of imports.entries()) {
      if (alias.endsWith("/*")) {
        const aliasPrefix = alias.slice(0, -2); // Remove /*
        if (modulePath.startsWith(aliasPrefix + "/")) {
          const suffix = modulePath.slice(aliasPrefix.length + 1); // Get part after prefix/
          const targetPrefix = target.endsWith("/*")
            ? target.slice(0, -2)
            : target;
          const resolved = path.resolve(packageDir, targetPrefix, suffix);
          return normalizePath(resolved);
        }
      }
    }

    return null;
  }

  /**
   * Find the nearest package.json by traversing up from the file's directory.
   * Stops at workspaceRoot.
   */
  private async findNearestPackageJson(
    filePath: string,
  ): Promise<string | null> {
    const startDir = path.dirname(filePath);

    // Check cache first for this directory
    if (this.directoryToPackageJson.has(startDir)) {
      return this.directoryToPackageJson.get(startDir) ?? null;
    }

    const result = await this.searchPackageJsonUpward(startDir);
    return result;
  }

  /**
   * Search for package.json by traversing up directories.
   * Caches results for all checked directories.
   */
  private async searchPackageJsonUpward(
    startDir: string,
  ): Promise<string | null> {
    const checkedDirs: string[] = [];
    let currentDir = startDir;

    while (!shouldStopSearch(this.workspaceRoot, currentDir)) {
      checkedDirs.push(currentDir);

      // Check if we already know the result for this directory
      const cachedResult = this.directoryToPackageJson.get(currentDir);
      if (cachedResult !== undefined) {
        this.cacheResultForDirs(checkedDirs, cachedResult);
        return cachedResult;
      }

      const packageJsonPath = path.join(currentDir, "package.json");
      if (await fileExists(packageJsonPath)) {
        this.cacheResultForDirs(checkedDirs, packageJsonPath);
        return packageJsonPath;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached filesystem root
      }
      currentDir = parentDir;
    }

    // No package.json found
    this.cacheResultForDirs(checkedDirs, null);
    return null;
  }

  /** Cache the package.json result for all checked directories */
  private cacheResultForDirs(dirs: string[], result: string | null): void {
    for (const dir of dirs) {
      this.directoryToPackageJson.set(dir, result);
    }
  }

  /** Get parsed imports from a package.json file (cached) */
  private async getPackageJsonImports(
    packageJsonPath: string,
  ): Promise<Map<string, string>> {
    // Return from cache if already loaded
    const cachedImports = this.packageJsonImports.get(packageJsonPath);
    if (cachedImports !== undefined) {
      return cachedImports;
    }

    // Check if already loading
    const loadingImportPromise = this.packageJsonLoadPromises.get(packageJsonPath);
    if (loadingImportPromise !== undefined) {
      return loadingImportPromise;
    }

    // Start loading and cache the promise
    const loadPromise = this.loadPackageJsonImports(packageJsonPath);
    this.packageJsonLoadPromises.set(packageJsonPath, loadPromise);

    try {
      const imports = await loadPromise;
      this.packageJsonImports.set(packageJsonPath, imports);
      return imports;
    } finally {
      this.packageJsonLoadPromises.delete(packageJsonPath);
    }
  }

  /**
   * Load and parse the imports field from a package.json file.
   * Also loads aliases field if present (custom extension for @alias support).
   */
  private async loadPackageJsonImports(
    packageJsonPath: string,
  ): Promise<Map<string, string>> {
    const imports = new Map<string, string>();

    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);

      // Load standard Node.js subpath imports (#imports)
      this.parseImportsField(packageJson?.imports, imports);

      // Also check "aliases" field (some projects use this for @scope/package mappings)
      this.parseAliasesField(packageJson?.aliases, imports);
    } catch {
      // Gracefully handle missing or invalid package.json
    }

    return imports;
  }

  /** Parse the imports field from package.json */
  private parseImportsField(
    importsField: unknown,
    imports: Map<string, string>,
  ): void {
    if (!importsField || typeof importsField !== "object") {
      return;
    }

    for (const [alias, target] of Object.entries(importsField)) {
      const resolved = this.resolveImportTarget(target);
      if (resolved) {
        imports.set(alias, resolved);
      }
    }
  }

  /** Resolve an import target (handles simple strings and conditional exports) */
  private resolveImportTarget(target: unknown): string | null {
    if (typeof target === "string") {
      return target;
    }

    if (typeof target === "object" && target !== null) {
      const obj = target as Record<string, unknown>;
      const resolved = obj.default ?? obj.import ?? obj.require ?? obj.node;
      if (typeof resolved === "string") {
        return resolved;
      }
    }

    return null;
  }

  /** Parse the aliases field from package.json (custom extension) */
  private parseAliasesField(
    aliasesField: unknown,
    imports: Map<string, string>,
  ): void {
    if (!aliasesField || typeof aliasesField !== "object") {
      return;
    }

    for (const [alias, target] of Object.entries(aliasesField)) {
      if (typeof target === "string") {
        imports.set(alias, target);
      }
    }
  }
}

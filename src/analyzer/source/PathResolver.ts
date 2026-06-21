import * as path from "node:path";
import {
  hasFileExtension,
  isNodeModule,
  isPackageJsonAliasCandidate,
  isPythonFile,
  isRelativePath,
  isSubpathImport,
} from "../utils/pathPredicates";
import { resolveWithExtensions } from "./pathFs";
import { TsConfigResolver } from "./TsConfigResolver";
import { PackageJsonResolver } from "./PackageJsonResolver";
import { WorkspaceResolver } from "./WorkspaceResolver";
import { PythonModuleResolver } from "./PythonModuleResolver";
import { RustModuleResolver } from "./RustModuleResolver";

/**
 * Resolves module paths to absolute file paths
 * Handles:
 * - Relative imports (./utils, ../components/Button)
 * - TypeScript path aliases (@/, @components/)
 * - Node.js subpath imports (#internal/utils) via package.json "imports" field
 * - Implicit extensions (.ts, .tsx, .js, .jsx)
 * - Index files (/index.ts)
 *
 * Monorepo-aware: discovers the nearest package.json for #imports resolution
 *
 * Thin orchestrator: delegates tsconfig / package.json / workspace / python /
 * rust resolution to dedicated sub-resolvers, each owning its own cache state.
 *
 * CRITICAL: NO vscode imports allowed - pure Node.js only
 */
export class PathResolver {
  private readonly tsConfig: TsConfigResolver;
  private readonly packageJson: PackageJsonResolver;
  private readonly workspace: WorkspaceResolver;
  private readonly python: PythonModuleResolver;
  private readonly rust: RustModuleResolver;

  private readonly workspaceRoot?: string;
  private excludeNodeModules: boolean;

  constructor(
    tsConfigPath?: string,
    excludeNodeModules: boolean = true,
    workspaceRoot?: string,
  ) {
    this.excludeNodeModules = excludeNodeModules;
    // Use provided workspaceRoot, or derive from tsConfigPath, or undefined
    this.workspaceRoot =
      workspaceRoot ?? (tsConfigPath ? path.dirname(tsConfigPath) : undefined);

    this.tsConfig = new TsConfigResolver(tsConfigPath, this.workspaceRoot);
    this.packageJson = new PackageJsonResolver(this.workspaceRoot);
    this.workspace = new WorkspaceResolver(this.workspaceRoot);
    this.python = new PythonModuleResolver(this.workspaceRoot);
    this.rust = new RustModuleResolver();
  }

  /** Update configuration */
  updateConfig(excludeNodeModules: boolean) {
    this.excludeNodeModules = excludeNodeModules;
  }

  async resolve(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Load static tsconfig if provided (legacy behavior for backwards compatibility)
    await this.tsConfig.ensureTsConfigLoaded();

    // Try TypeScript config aliases
    const tsConfigResolved = await this.tryTsConfigAliases(
      currentFilePath,
      modulePath,
    );
    if (tsConfigResolved) {
      return tsConfigResolved;
    }

    // Try special module patterns (subpath imports, Rust, scoped packages)
    const specialPatternResolved = await this.trySpecialModulePatterns(
      currentFilePath,
      modulePath,
    );
    if (specialPatternResolved) {
      return specialPatternResolved;
    }

    // Try Python-specific imports
    const pythonResolved = await this.python.tryPythonImports(
      currentFilePath,
      modulePath,
    );
    if (pythonResolved) {
      return pythonResolved;
    }

    // Handle node_modules
    if (isNodeModule(modulePath)) {
      return this.excludeNodeModules ? null : modulePath;
    }

    // Try relative paths
    return this.tryRelativePath(currentFilePath, modulePath);
  }

  /** Try to resolve using TypeScript config aliases (static and dynamic) */
  private async tryTsConfigAliases(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Try static tsconfig alias (priority 1a)
    const staticAliasResolved = this.tsConfig.resolveAlias(modulePath);
    if (staticAliasResolved) {
      return resolveWithExtensions(staticAliasResolved);
    }

    // Try dynamic tsconfig alias (priority 1b)
    const dynamicAliasResolved = await this.tsConfig.resolveDynamicTsConfigAlias(
      currentFilePath,
      modulePath,
    );
    if (dynamicAliasResolved) {
      return resolveWithExtensions(dynamicAliasResolved);
    }

    return null;
  }

  /**
   * Try to resolve special module patterns (subpath imports, Rust, scoped packages)
   */
  private async trySpecialModulePatterns(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Handle #imports (Node.js subpath imports)
    if (isSubpathImport(modulePath)) {
      return this.resolveSubpathImport(currentFilePath, modulePath);
    }

    // Rust bare module names (e.g., `helper`, `utils::parser`)
    const rustResolved = await this.rust.resolveRustModule(
      currentFilePath,
      modulePath,
    );
    if (rustResolved) {
      return rustResolved;
    }

    // Handle @scope/package patterns
    if (isPackageJsonAliasCandidate(modulePath)) {
      return this.resolveScopedPackage(currentFilePath, modulePath);
    }

    return null;
  }

  /** Resolve Node.js subpath import (#import) */
  private async resolveSubpathImport(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    const resolved = await this.packageJson.resolvePackageJsonImport(
      currentFilePath,
      modulePath,
    );
    if (resolved) {
      return resolveWithExtensions(resolved);
    }
    return null;
  }

  /** Resolve @scope/package pattern (package.json imports, workspace package, or node_module) */
  private async resolveScopedPackage(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Try package.json imports field
    const pkgJsonResolved = await this.packageJson.resolvePackageJsonImport(
      currentFilePath,
      modulePath,
    );
    if (pkgJsonResolved) {
      return resolveWithExtensions(pkgJsonResolved);
    }

    // Try file: dependency resolution (from package.json dependencies)
    const fileDependencyResolved = await this.workspace.resolveWorkspacePackage(
      currentFilePath,
      modulePath,
    );
    if (fileDependencyResolved) {
      return fileDependencyResolved;
    }

    // Treat as node_module
    return this.excludeNodeModules ? null : modulePath;
  }

  /** Try to resolve relative path with appropriate extensions */
  private async tryRelativePath(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    if (!isRelativePath(modulePath)) {
      return null;
    }

    const currentDir = path.dirname(currentFilePath);
    const absolutePath = path.resolve(currentDir, modulePath);

    // For Python files with relative imports, try with .py extension if not already present
    if (isPythonFile(currentFilePath) && !hasFileExtension(modulePath)) {
      const resolved = await resolveWithExtensions(absolutePath);
      if (resolved) {
        return resolved;
      }
    }

    return resolveWithExtensions(absolutePath);
  }
}

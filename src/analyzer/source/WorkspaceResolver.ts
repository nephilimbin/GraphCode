import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizePath } from "../foundation/types";
import { fileExists, resolveWithExtensions, shouldStopSearch } from "./fileResolve";

/**
 * Workspace / monorepo package resolution.
 *
 * Resolves `@scope/package` specifiers to local workspace packages via
 * `file:` dependencies declared in package.json, or via common monorepo
 * package locations (packages/ / libs/ / modules/).
 */
export class WorkspaceResolver {
  private readonly workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Try to resolve @scope/package as a local workspace package.
   * Supports:
   * 1. "file:" dependencies in package.json (e.g., "@company/auth-lib": "file:../packages/auth-lib")
   * 2. Common monorepo package locations (packages/, libs/, modules/)
   */
  async resolveWorkspacePackage(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    if (!modulePath.startsWith("@")) {
      return null;
    }

    // Extract scope and package name: @company/auth-lib -> company, auth-lib
    const regex = /^@([^/]+)\/([^/]+)(\/.*)?$/;
    const match = regex.exec(modulePath);
    if (!match) {
      return null;
    }

    const [, , packageName, subpath] = match;
    const fullPackageName = modulePath.split("/").slice(0, 2).join("/"); // @company/auth-lib

    // Try file: dependency resolution first (from nearest package.json dependencies)
    const fileDependencyDir = await this.resolveFileDependency(
      currentFilePath,
      fullPackageName,
    );
    if (fileDependencyDir) {
      return this.resolvePackageEntry(fileDependencyDir, modulePath, subpath);
    }

    // Fallback: try common monorepo package locations
    if (this.workspaceRoot) {
      const packageDir = await this.findWorkspacePackageDir(packageName);
      if (packageDir) {
        return this.resolvePackageEntry(packageDir, modulePath, subpath);
      }
    }

    return null;
  }

  /**
   * Resolve a package that's defined as "file:" dependency in package.json.
   * Searches upward through all package.json files to find the dependency.
   * In monorepos, file: dependencies may be declared in a parent package.json
   * e.g., "@company/auth-lib": "file:../packages/auth-lib"
   */
  private async resolveFileDependency(
    currentFilePath: string,
    packageName: string,
  ): Promise<string | null> {
    const startDir = path.dirname(currentFilePath);
    let currentDir = startDir;

    // Search upward through all package.json files
    while (!shouldStopSearch(this.workspaceRoot, currentDir)) {
      const packageJsonPath = path.join(currentDir, "package.json");

      if (await fileExists(packageJsonPath)) {
        const result = await this.findFileDependencyInPackageJson(
          packageJsonPath,
          packageName,
        );
        if (result) {
          return result;
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached filesystem root
      }
      currentDir = parentDir;
    }

    return null;
  }

  /** Look for a file: dependency in a package.json file */
  private async findFileDependencyInPackageJson(
    packageJsonPath: string,
    packageName: string,
  ): Promise<string | null> {
    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkgJson = JSON.parse(content);
      const packageDir = path.dirname(packageJsonPath);

      // Check dependencies, devDependencies, and peerDependencies for file: references
      const allDeps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
        ...pkgJson.peerDependencies,
      };

      const depValue = allDeps[packageName];

      if (typeof depValue === "string" && depValue.startsWith("file:")) {
        // Remove "file:" prefix and resolve relative to package.json directory
        const relativePath = depValue.slice(5);
        const absolutePath = path.resolve(packageDir, relativePath);
        const normalized = normalizePath(absolutePath);

        // Verify the directory exists and has a package.json
        const depPackageJson = path.join(absolutePath, "package.json");
        const exists = await fileExists(depPackageJson);

        if (exists) {
          return normalized;
        }
      }
    } catch {
      // Ignore errors reading package.json
    }

    return null;
  }

  /** Find the package directory in the workspace */
  private async findWorkspacePackageDir(
    packageName: string,
  ): Promise<string | null> {
    if (!this.workspaceRoot) {
      return null;
    }

    // Common monorepo package locations
    const locations = ["packages", "libs", "modules"];

    for (const loc of locations) {
      const packageDir = path.join(this.workspaceRoot, loc, packageName);
      const packageJsonPath = path.join(packageDir, "package.json");

      if (await fileExists(packageJsonPath)) {
        return packageDir;
      }
    }

    return null;
  }

  /** Resolve the entry point of a workspace package */
  private async resolvePackageEntry(
    packageDir: string,
    modulePath: string,
    subpath?: string,
  ): Promise<string | null> {
    const packageJsonPath = path.join(packageDir, "package.json");

    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkgJson = JSON.parse(content);

      // Verify this is the right package
      // Package can be named @scope/package or just package (for file: dependencies)
      const expectedName = modulePath.split("/").slice(0, 2).join("/"); // @company/auth-lib
      const shortName = modulePath.split("/").slice(1, 2).join("/"); // auth-lib
      const pkgName = pkgJson.name as string;

      // Accept if package name matches either the full scoped name or just the short name
      if (pkgName !== expectedName && pkgName !== shortName) {
        return null;
      }

      // Handle subpath imports
      if (subpath) {
        const srcDir = pkgJson.source ? path.dirname(pkgJson.source) : "src";
        const subpathResolved = path.join(packageDir, srcDir, subpath);
        return resolveWithExtensions(subpathResolved);
      }

      // Try common entry points
      return this.findPackageEntryPoint(packageDir, pkgJson);
    } catch {
      return null;
    }
  }

  /** Find the entry point of a package */
  private async findPackageEntryPoint(
    packageDir: string,
    pkgJson: Record<string, unknown>,
  ): Promise<string | null> {
    const main =
      (pkgJson.main as string) || (pkgJson.module as string) || "index";

    const entryPoints = [
      path.join(packageDir, "src", "index"),
      path.join(packageDir, main),
      path.join(packageDir, "index"),
    ];

    for (const entry of entryPoints) {
      const resolved = await resolveWithExtensions(entry);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }
}

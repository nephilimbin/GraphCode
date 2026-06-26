/**
 * @module dependon/languages
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Node, Parser } from "web-tree-sitter";
import { normalizePath } from "../core/Path";
import { FileReader } from "../infra/FileReader";
import { Dependency } from "../domain/Dependency";
import { ILanguageAnalyzer } from "../domain/Symbol";
import { DependonError } from "../core/Errors";
import { extractFilePath } from "../core/PathExtractor";
import { WasmParserFactory } from "../core/WasmParserFactory";
import { resolveWasmFile } from "../core/WasmResolver";

/**
 * Swift import parser backed by tree-sitter WASM.
 * Requires `extensionPath` to locate `dist/wasm`.
 * In unit tests, mock `WasmParserFactory` directly to avoid WASM initialization.
 */
export class SwiftParser implements ILanguageAnalyzer {
  private parser: Parser | null = null;
  private readonly fileReader: FileReader;
  private readonly rootDir: string;
  private readonly extensionPath?: string;
  private initPromise: Promise<void> | null = null;
  /** Cache module-name -> resolved entry path (or null) across calls. */
  private readonly moduleResolveCache = new Map<string, string | null>();

  constructor(rootDir?: string, extensionPath?: string) {
    this.fileReader = new FileReader();
    this.rootDir = rootDir || process.cwd();
    this.extensionPath = extensionPath;
  }

  /** Lazily initializes the WASM parser and reuses a single init promise. */
  private async ensureInitialized(): Promise<void> {
    // If parser is already initialized, return immediately
    if (this.parser) {
      return;
    }

    // Start initialization if not already in progress
    this.initPromise ??= (async () => {
      try {
        const factory = WasmParserFactory.getInstance();

        // Core + language WASM auto-located via WasmResolver (extensionPath optional)
        const treeSitterWasmPath = resolveWasmFile("tree-sitter.wasm", this.extensionPath);
        await factory.init(treeSitterWasmPath);

        const swiftWasmPath = resolveWasmFile("tree-sitter-swift.wasm", this.extensionPath);
        this.parser = await factory.getParser("swift", swiftWasmPath);
      } catch (error) {
        // Clear the promise so retry is possible
        this.initPromise = null;

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to initialize Swift WASM parser: ${errorMessage}`,
          { cause: error }
        );
      }
    })();

    await this.initPromise;
  }
  /**
   * Parse Swift imports from a file
   */
  async parseImports(filePath: string): Promise<Dependency[]> {
    try {
      // Ensure WASM parser is initialized
      await this.ensureInitialized();

      // Extract file path from potential symbol ID
      const actualPath = extractFilePath(filePath);
      const content = await this.fileReader.readFile(actualPath);
      const tree = this.parser?.parse(content);
      if (!tree) {
        throw new Error(`Failed to parse Swift file: ${actualPath}`);
      }
      const dependencies: Dependency[] = [];
      const seen = new Set<string>();

      this.traverseTree(tree.rootNode, (node) => {
        // Handle: import module
        if (node.type === "import_declaration") {
          this.extractImportDeclaration(node, dependencies, seen, content);
        }
      });

      return dependencies;
    } catch (error) {
      throw DependonError.fromError(error, filePath);
    }
  }

  /**
   * Resolve Swift module path to absolute file path
   */
  async resolvePath(
    fromFile: string,
    moduleSpecifier: string,
  ): Promise<string | null> {
    try {
      // Ensure WASM parser is initialized
      await this.ensureInitialized();

      // Extract file path from potential symbol ID
      const actualFromFile = extractFilePath(fromFile);
      const fromDir = path.dirname(actualFromFile);

      // Handle relative imports (., ..)
      if (moduleSpecifier.startsWith(".")) {
        return await this.resolveRelativeImport(fromDir, moduleSpecifier);
      }

      // Handle absolute imports (workspace-relative)
      return await this.resolveAbsoluteImport(fromDir, moduleSpecifier);
    } catch {
      // Resolution failures are not critical - return null
      return null;
    }
  }

  /**
   * Extract import declaration: import module
   */
  private extractImportDeclaration(
    node: Node,
    dependencies: Dependency[],
    seen: Set<string>,
    content: string,
  ): void {
    // Swift grammar: import_declaration -> identifier -> simple_identifier(s).
    //   import Foundation         => identifier("Foundation")
    //   import UIKit.UIColor      => identifier("UIKit.UIColor")
    //   import class RSCore.Foo   => identifier("RSCore.Foo") (kind keyword lives elsewhere)
    let module: string | null = null;

    const identifier = this.findChildByType(node, "identifier");
    if (identifier) {
      module = this.getNodeText(identifier, content).trim();
    } else {
      // Fallback for grammars that wrap the path in import_path
      const importPath = this.findChildByType(node, "import_path");
      if (importPath) {
        module = this.getNodeText(importPath, content).trim();
      }
    }

    if (module && !seen.has(module)) {
      seen.add(module);
      dependencies.push({
        path: "",
        type: "import",
        line: node.startPosition.row + 1,
        module,
      });
    }
  }

  /**
   * Resolve relative import (., .., .module)
   */
  private async resolveRelativeImport(
    fromDir: string,
    moduleSpecifier: string,
  ): Promise<string | null> {
    // Count leading dots
    const dotsMatch = /^\.*/u.exec(moduleSpecifier);
    const dots = dotsMatch ? dotsMatch[0].length : 0;
    const modulePath = moduleSpecifier.slice(dots).replaceAll(".", "/");

    // Navigate up directories based on dot count
    let currentDir = fromDir;
    for (let i = 1; i < dots; i++) {
      currentDir = path.dirname(currentDir);
    }

    // Try different file patterns for Swift
    const candidates = [
      path.join(currentDir, modulePath + ".swift"),
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return normalizePath(candidate);
      }
    }

    return null;
  }

  /**
   * Resolve absolute import. Swift modules are usually directories
   * (e.g. `import Account` -> Modules/Account/Sources/Account/), so unlike a
   * single-file lookup we also resolve a directory to a representative .swift
   * entry file — mirroring Python's `foo/__init__.py`. A project-wide breadth-
   * first search is the final fallback because module folders often sit in a
   * sibling directory (Modules/) that the upward walk cannot reach.
   */
  private async resolveAbsoluteImport(
    fromDir: string,
    moduleSpecifier: string,
  ): Promise<string | null> {
    const modulePath = moduleSpecifier.replaceAll(".", "/");
    const moduleName = modulePath.split("/")[0];

    const cached = this.moduleResolveCache.get(moduleName);
    if (cached !== undefined) {
      return cached;
    }

    const normalizedRoot = normalizePath(this.rootDir);
    const seen = new Set<string>();

    const tryDir = async (dir: string): Promise<string | null> => {
      const nd = normalizePath(dir);
      if (seen.has(nd)) {
        return null;
      }
      seen.add(nd);
      return this.resolveModuleInDir(dir, modulePath, moduleName);
    };

    // 1. Walk up from the importing file's directory to the workspace root.
    let currentDir = fromDir;
    while (true) {
      const resolved = await tryDir(currentDir);
      if (resolved) {
        return this.cacheModule(moduleName, resolved);
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached filesystem root
      }

      // Stop after checking the workspace root to avoid scanning unrelated paths
      if (normalizePath(parentDir) === normalizedRoot) {
        const resolvedAtRoot = await tryDir(parentDir);
        if (resolvedAtRoot) {
          return this.cacheModule(moduleName, resolvedAtRoot);
        }
        break;
      }

      currentDir = parentDir;
    }

    // 2. Fallback: try the configured root if it was not part of the climb.
    if (!seen.has(normalizedRoot)) {
      const resolvedAtRoot = await tryDir(this.rootDir);
      if (resolvedAtRoot) {
        return this.cacheModule(moduleName, resolvedAtRoot);
      }
    }

    // 3. Project-wide search (reaches sibling dirs like Modules/).
    const found = await this.searchModuleInTree(this.rootDir, moduleName, 5, new Set());
    return this.cacheModule(moduleName, found);
  }

  private cacheModule(moduleName: string, resolved: string | null): string | null {
    this.moduleResolveCache.set(moduleName, resolved);
    return resolved;
  }

  /** Resolve a module name under `dir` to a representative .swift file. */
  private async resolveModuleInDir(
    dir: string,
    modulePath: string,
    moduleName: string,
  ): Promise<string | null> {
    // A Swift module is always a compilation unit; at the source level it lives
    // under a SwiftPM `Sources/<module>/` target, never as a lone `<module>.swift`
    // file. Accepting a same-named file anywhere in the tree (e.g. the project's
    // own `Mac/CrashReporter/CrashReporter.swift`) would wrongly link a system
    // framework import to an unrelated local file. So only directory targets match.
    //
    // 1. SwiftPM target: <dir>/<module>/Sources/<module>/
    const moduleDir = path.join(dir, modulePath);
    if (await this.isDirectory(moduleDir)) {
      const entry = await this.swiftEntryInTarget(
        path.join(moduleDir, "Sources", moduleName),
        moduleName,
      );
      if (entry) {
        return normalizePath(entry);
      }
    }

    // 2. Single-package layout: <dir>/Sources/<module>/ (dir is the module root)
    const flatEntry = await this.swiftEntryInTarget(
      path.join(dir, "Sources", moduleName),
      moduleName,
    );
    if (flatEntry) {
      return normalizePath(flatEntry);
    }

    return null;
  }

  /** Return a representative .swift entry inside a SwiftPM Sources/<module> target. */
  private async swiftEntryInTarget(
    targetDir: string,
    moduleName: string,
  ): Promise<string | null> {
    if (!(await this.isDirectory(targetDir))) {
      return null;
    }
    return this.firstSwiftEntry(targetDir, moduleName);
  }

  /** Prefer <module>.swift, otherwise the first .swift in the directory. */
  private async firstSwiftEntry(
    dir: string,
    moduleName: string,
  ): Promise<string | null> {
    const sameName = path.join(dir, moduleName + ".swift");
    if (await this.isFile(sameName)) {
      return sameName;
    }
    try {
      const entries = await fs.readdir(dir);
      const swift = entries.find((e) => e.endsWith(".swift"));
      return swift ? path.join(dir, swift) : null;
    } catch {
      return null;
    }
  }

  /** Breadth-first search for a module folder/file under `root` (depth-limited). */
  private async searchModuleInTree(
    root: string,
    moduleName: string,
    maxDepth: number,
    visited: Set<string>,
  ): Promise<string | null> {
    const queue: Array<{ dir: string; depth: number }> = [
      { dir: root, depth: 0 },
    ];
    while (queue.length > 0) {
      const { dir, depth } = queue.shift()!;
      const nd = normalizePath(dir);
      if (visited.has(nd)) {
        continue;
      }
      visited.add(nd);

      const resolved = await this.resolveModuleInDir(dir, moduleName, moduleName);
      if (resolved) {
        return resolved;
      }

      if (depth >= maxDepth) {
        continue;
      }
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) {
            continue;
          }
          // Skip noise / dependency directories.
          if (
            e.name.startsWith(".") ||
            e.name === "Tests" ||
            e.name === "test" ||
            e.name === "node_modules" ||
            e.name === "build" ||
            e.name === "DerivedData"
          ) {
            continue;
          }
          queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
      } catch {
        // Ignore unreadable directories.
      }
    }
    return null;
  }

  private async isFile(filePath: string): Promise<boolean> {
    try {
      return (await fs.stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private async isDirectory(dirPath: string): Promise<boolean> {
    try {
      return (await fs.stat(dirPath)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Traverse tree and call visitor for each node
   */
  private traverseTree(
    node: Node,
    visitor: (node: Node) => void,
  ): void {
    visitor(node);
    for (const child of node.children) {
      this.traverseTree(child, visitor);
    }
  }

  /**
   * Find first child of a specific type
   */
  private findChildByType(
    node: Node,
    type: string,
  ): Node | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Get text content of a node
   */
  private getNodeText(node: Node, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }
}

import * as path from "node:path";
import { normalizePath } from "../foundation/types";
import { isPythonFile, isPythonRelativeImport } from "../utils/PathPredicates";
import { fileExists } from "./pathFs";

/**
 * Python-specific module-specifier resolution.
 *
 * Handles Python relative imports (`.helpers`, `..utils`) and absolute dotted
 * module paths (`utils.database` → `utils/database.py`), walking up to the
 * workspace root.
 */
export class PythonModuleResolver {
  private readonly workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async tryPythonImports(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    if (!isPythonFile(currentFilePath)) {
      return null;
    }

    // Try Python relative imports FIRST (.helpers, ..utils, etc.)
    if (isPythonRelativeImport(modulePath)) {
      const pythonResolved = await this.resolvePythonRelativeImport(
        currentFilePath,
        modulePath,
      );
      if (pythonResolved) {
        return pythonResolved;
      }
    }

    // Try Python absolute module resolution (utils.database → utils/database.py)
    if (modulePath.includes(".") && !modulePath.includes("/")) {
      const pythonResolved = await this.resolvePythonModule(
        currentFilePath,
        modulePath,
      );
      if (pythonResolved) {
        return pythonResolved;
      }
    }

    return null;
  }

  /** Resolve Python relative import (.helpers → ./helpers.py, ..utils → ../utils.py) */
  private async resolvePythonRelativeImport(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    const currentDir = path.dirname(currentFilePath);

    // Count leading dots to determine relative level
    let level = 0;
    let moduleName = modulePath;
    while (moduleName.startsWith(".")) {
      level++;
      moduleName = moduleName.substring(1);
    }

    // Navigate up 'level - 1' directories (one dot is current dir)
    let targetDir = currentDir;
    for (let i = 1; i < level; i++) {
      targetDir = path.dirname(targetDir);
    }

    // If there's a module name after the dots, append it
    if (moduleName) {
      const moduleFilePath = path.join(targetDir, moduleName + ".py");
      if (await fileExists(moduleFilePath)) {
        return normalizePath(moduleFilePath);
      }

      // Try __init__.py
      const initPath = path.join(targetDir, moduleName, "__init__.py");
      if (await fileExists(initPath)) {
        return normalizePath(initPath);
      }
    }

    return null;
  }

  /**
   * Resolve Python module path (utils.database → utils/database.py).
   * Walks up from current file directory to workspace root.
   */
  private async resolvePythonModule(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Convert module.submodule to module/submodule
    const moduleDirPath = modulePath.replaceAll(".", "/");
    const currentDir = path.dirname(currentFilePath);
    const workspaceRoot = this.workspaceRoot || currentDir;

    // Walk up from current directory to workspace root
    let searchDir = currentDir;
    while (true) {
      // Try module.py
      const pyFile = path.resolve(searchDir, moduleDirPath + ".py");
      if (await fileExists(pyFile)) {
        return normalizePath(pyFile);
      }

      // Try module/__init__.py
      const initFile = path.resolve(searchDir, moduleDirPath, "__init__.py");
      if (await fileExists(initFile)) {
        return normalizePath(initFile);
      }

      // Stop at workspace root
      if (normalizePath(searchDir) === normalizePath(workspaceRoot)) {
        break;
      }

      // Move up one directory
      const parentDir = path.dirname(searchDir);
      if (parentDir === searchDir) {
        // Reached filesystem root
        break;
      }
      searchDir = parentDir;
    }

    return null;
  }
}

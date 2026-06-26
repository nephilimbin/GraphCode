/**
 * @module dependon/resolution
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SUPPORTED_FILE_EXTENSIONS } from "../core/Constants";
import { normalizePath } from "../core/Path";

/**
 * Shared filesystem helpers for module-path resolution.
 *
 * Used by PathResolver and its sub-resolvers (tsconfig / packageJson /
 * workspace / python / rust) to avoid duplicating the extension / index
 * probing logic.
 */

/** True when the path exists and is a regular file. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a base path to an existing file by trying the exact path, then
 * appending each supported extension, then appending `/index<ext>`.
 */
export async function resolveWithExtensions(
  basePath: string,
): Promise<string | null> {
  const extensions = SUPPORTED_FILE_EXTENSIONS;

  // Try exact path first
  if (await fileExists(basePath)) {
    return normalizePath(basePath);
  }

  // Try with extensions
  for (const ext of extensions) {
    const pathWithExt = basePath + ext;
    if (await fileExists(pathWithExt)) {
      return normalizePath(pathWithExt);
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (await fileExists(indexPath)) {
      return normalizePath(indexPath);
    }
  }

  return null;
}

/**
 * Whether an upward config-file search (tsconfig.json / package.json) should
 * stop at the workspace boundary. Pure helper shared by the upward-searching
 * resolvers (tsconfig / packageJson / workspace).
 */
export function shouldStopSearch(
  workspaceRoot: string | undefined,
  currentDir: string,
): boolean {
  return Boolean(
    workspaceRoot && currentDir === path.dirname(workspaceRoot),
  );
}

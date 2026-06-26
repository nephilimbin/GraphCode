import * as path from "node:path";
import { IGNORED_DIRECTORIES, PYTHON_EXTENSIONS } from './Constants';
import { normalizePath } from './Path';

/**
 * Path predicates — dependon core.
 *
 * Pure string classification — no IO, no state. Used by PathResolver and its
 * sub-resolvers to dispatch module-specifier resolution strategies.
 *
 * @module dependon/core
 */

/**
 * Check if a file path is inside an ignored directory (cross-platform).
 */
export function isInIgnoredDirectory(filePath: string): boolean {
  const normalized = normalizePath(filePath);

  const segments = normalized.split('/');

  for (let i = 0; i < segments.length - 1; i++) {
    if (IGNORED_DIRECTORIES.includes(segments[i])) {
      return true;
    }
  }

  return false;
}

/** Relative import: starts with `./` or `../`. */
export function isRelativePath(modulePath: string): boolean {
  return modulePath.startsWith("./") || modulePath.startsWith("../");
}

/** Bare node_modules import (not relative, absolute, subpath, or scoped). */
export function isNodeModule(modulePath: string): boolean {
  return (
    !modulePath.startsWith(".") &&
    !modulePath.startsWith("/") &&
    !modulePath.startsWith("#") &&
    !modulePath.startsWith("@")
  );
}

/** Node.js subpath import (`#internal/...`). */
export function isSubpathImport(modulePath: string): boolean {
  return modulePath.startsWith("#");
}

/** Candidate for package.json imports/aliases field (`@alias/...`). */
export function isPackageJsonAliasCandidate(modulePath: string): boolean {
  return modulePath.startsWith("@");
}

/** Whether a module specifier already carries a file extension. */
export function hasFileExtension(modulePath: string): boolean {
  const basename = path.basename(modulePath);
  return basename.includes('.') && !basename.startsWith('.');
}

/** Python relative import (`.helpers`, `..utils` — dot prefix, no slash). */
export function isPythonRelativeImport(modulePath: string): boolean {
  return (modulePath.startsWith('.') || modulePath.startsWith('..')) &&
         !modulePath.includes('/') &&
         modulePath !== '.' && modulePath !== '..';
}

/** Whether a file path has a Python extension. */
export function isPythonFile(filePath: string): boolean {
  return PYTHON_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

/**
 * WASM / Query Resource Resolver — dependon core.
 *
 * Locates runtime resources: the `dist/` folder bundling `wasm/*.wasm`
 * tree-sitter binaries (+ sqljs.wasm) and `queries/*.scm` query files.
 *
 * Resolution order (first match wins):
 *   1. `extensionPath` (caller-provided package root) → `<extensionPath>/dist`
 *   2. module-dir-relative candidates (bundled package layout)
 *   3. `process.cwd()/dist` (last resort — logs a warning so a missing wasm
 *      fails loudly downstream instead of silently)
 *
 * Lets dependon run with zero configuration: callers pass `extensionPath`
 * only when resources live outside the default `dist/` layout.
 *
 * @module dependon/core
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "./Logger";

const log = getLogger("wasm-resolver");

/**
 * Resolve the current module directory in both ESM and CJS contexts.
 *
 * The main library runs as ESM (import.meta.url). Worker scripts are bundled
 * to CJS by esbuild, where import.meta.url is empty — fall back to __dirname
 * (available in CJS) and finally process.cwd().
 */
function getCurrentDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  }
}
const currentDir = getCurrentDir();

/**
 * Resolve the resources directory (the `dist/` folder containing `wasm/` and
 * `queries/`). See module doc for resolution order.
 *
 * @param extensionPath - Optional package root. Omitted → auto-locate.
 * @returns Absolute path to the resources directory.
 */
export function resolveResourcesDir(extensionPath?: string): string {
  if (extensionPath) {
    return path.join(extensionPath, "dist");
  }

  // module dir varies by run context:
  //   - bundled: <pkg>/dist/core/  → wasm/ one level up
  //   - src run: <root>/dependon/src/core/ → walk up to <root>/dependon/dist
  const candidates: string[] = [
    currentDir,
    path.join(currentDir, ".."),
    path.join(currentDir, "..", "..", "dist"),
    path.join(currentDir, "..", "..", "..", "dist"),
  ];

  for (const candidate of candidates) {
    if (hasCoreWasm(candidate)) {
      return candidate;
    }
  }

  const fallback = path.join(process.cwd(), "dist");
  log.warn(
    `Could not locate resources directory near ${currentDir}; ` +
      `falling back to ${fallback}. If WASM parsing fails, pass extensionPath explicitly.`,
  );
  return fallback;
}

/** Absolute path to a tree-sitter / sqljs WASM binary (e.g. "tree-sitter-rust.wasm"). */
export function resolveWasmFile(filename: string, extensionPath?: string): string {
  return path.join(resolveResourcesDir(extensionPath), "wasm", filename);
}

/** Absolute path to a tree-sitter query file (e.g. "typescript.scm"). */
export function resolveQueryFile(filename: string, extensionPath?: string): string {
  return path.join(resolveResourcesDir(extensionPath), "queries", filename);
}

/** True when the directory contains the core `wasm/tree-sitter.wasm` binary. */
function hasCoreWasm(resourcesDir: string): boolean {
  try {
    return existsSync(path.join(resourcesDir, "wasm", "tree-sitter.wasm"));
  } catch {
    return false;
  }
}

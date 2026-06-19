/**
 * Analyzer WASM / Query Resource Resolver
 *
 * Self-contained locator for the analyzer's runtime resources: the `dist/`
 * folder that bundles `wasm/*.wasm` tree-sitter binaries (+ `sqljs.wasm`)
 * and `queries/*.scm` tree-sitter query files.
 *
 * Resolution order (first match wins):
 *   1. `extensionPath` (caller-provided package root) → `<extensionPath>/dist`
 *   2. `__dirname`-relative candidates (bundled VS Code extension + npm package)
 *   3. `process.cwd()/dist` (last resort — logs a warning so a missing wasm
 *      fails loudly downstream instead of silently)
 *
 * This lets the analyzer run as a standalone SDK with zero configuration:
 * callers only pass `extensionPath` when resources live outside the default
 * `dist/` layout. Mirrors the existing __dirname-based worker location logic
 * in IndexerWorkerHost / AstWorkerHost.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getLogger } from "./logger";

const log = getLogger("wasm-resolver");

/**
 * Resolve the analyzer resources directory (the `dist/` folder containing
 * `wasm/` and `queries/`). See module doc for resolution order.
 *
 * @param extensionPath - Optional package root (e.g. VS Code context.extensionPath).
 *                        Omitted → auto-locate via __dirname / cwd fallbacks.
 * @returns Absolute path to the resources directory.
 */
export function resolveResourcesDir(extensionPath?: string): string {
  if (extensionPath) {
    return path.join(extensionPath, "dist");
  }

  // __dirname varies by run context (see AstWorkerHost comments):
  //   - bundled: __dirname === <pkg>/dist/        → wasm/ is right here
  //   - src run: __dirname === src/analyzer[/...] → walk up to <root>/dist
  const candidates: string[] = [
    __dirname,
    path.join(__dirname, ".."),
    path.join(__dirname, "..", "..", "dist"),
    path.join(__dirname, "..", "..", "..", "dist"),
  ];

  for (const candidate of candidates) {
    if (hasCoreWasm(candidate)) {
      return candidate;
    }
  }

  const fallback = path.join(process.cwd(), "dist");
  log.warn(
    `Could not locate resources directory near ${__dirname}; ` +
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

import * as path from "node:path";
import { normalizePath } from "../foundation/types";
import { fileExists } from "./pathFs";

/**
 * Rust module-specifier resolution.
 *
 * Resolves bare Rust module identifiers (`helper`, `utils::parser`) to the
 * corresponding `<name>.rs` / `<dir>/mod.rs` files relative to the importing
 * file. Only applies to `.rs` sources and Rust-like identifiers (no leading
 * `.`, `@`, `#`, `/`).
 */
export class RustModuleResolver {
  async resolveRustModule(
    currentFilePath: string,
    modulePath: string,
  ): Promise<string | null> {
    // Only apply to Rust sources and bare/qualified module identifiers (no slashes or leading dot/@/#)
    if (!currentFilePath.endsWith(".rs")) {
      return null;
    }

    if (
      modulePath.startsWith(".") ||
      modulePath.startsWith("@") ||
      modulePath.startsWith("#") ||
      modulePath.startsWith("/")
    ) {
      return null;
    }

    // Accept plain identifiers or path segments separated by '::'
    const isRustLike = /^\w+(?:::\w+)*$/u.test(modulePath);
    if (!isRustLike) {
      return null;
    }

    const fromDir = path.dirname(currentFilePath);
    const moduleRelPath = modulePath.replaceAll("::", path.sep);

    const candidates = [
      path.join(fromDir, `${moduleRelPath}.rs`),
      path.join(fromDir, moduleRelPath, "mod.rs"),
    ];

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return normalizePath(candidate);
      }
    }

    return null;
  }
}

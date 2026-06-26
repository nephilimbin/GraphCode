/**
 * JSONC parser — dependon core.
 *
 * Parse JSONC (JSON with Comments) — tolerates `//` line comments, block
 * comments and trailing commas, then delegates to `JSON.parse`.
 *
 * Zero-dependency by design. A hand-rolled state machine — not a regex — is
 * used so that comment markers and commas *inside string literals* are never
 * stripped (a regex would corrupt values like `"http://..."` or `"a,}"`).
 *
 * Primary use: tsconfig.json, which the TypeScript compiler parses leniently
 * but `JSON.parse` rejects.
 *
 * @module dependon/core
 */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripJsonc(text)) as T;
}

type State = "default" | "string" | "line" | "block";

/**
 * Remove JSONC comments and trailing commas, preserving string-literal contents.
 */
function stripJsonc(text: string): string {
  let result = "";
  let i = 0;
  let state: State = "default";
  let pendingComma = false;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (state === "string") {
      result += c;
      if (c === "\\") {
        if (next !== undefined) {
          result += next;
          i += 2;
          continue;
        }
      } else if (c === '"') {
        state = "default";
      }
      i += 1;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "default";
      }
      i += 1;
      continue;
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "default";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // state === "default"
    if (c === '"') {
      flushComma();
      result += '"';
      state = "string";
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      state = "line";
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      state = "block";
      i += 2;
      continue;
    }
    if (c === ",") {
      if (pendingComma) {
        result += ",";
      }
      pendingComma = true;
      i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (!pendingComma) {
        result += c;
      }
      i += 1;
      continue;
    }
    if (c === "}" || c === "]") {
      pendingComma = false; // drop trailing comma
      result += c;
      i += 1;
      continue;
    }

    flushComma();
    result += c;
    i += 1;
    continue;
  }

  return result;

  function flushComma(): void {
    if (pendingComma) {
      result += ",";
      pendingComma = false;
    }
  }
}

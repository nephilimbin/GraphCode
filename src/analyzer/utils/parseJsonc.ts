/**
 * Parse JSONC (JSON with Comments) — tolerates `//` line comments, `/* *​/`
 * block comments and trailing commas, then delegates to `JSON.parse`.
 *
 * Zero-dependency by design: the analyzer core must stay free of external
 * dependencies (see analyzer-standalone-core). A hand-rolled state machine —
 * not a regex — is used so that comment markers and commas *inside string
 * literals* are never stripped (a regex would corrupt values like
 * `"http://..."` or `"a,}"`).
 *
 * Primary use: tsconfig.json, which the TypeScript compiler parses leniently
 * but `JSON.parse` rejects. Previously a comment-bearing tsconfig threw inside
 * `JSON.parse`, was swallowed by a silent catch, and left `@/` path aliases
 * unconfigured — see `TsConfigResolver`.
 */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripJsonc(text)) as T;
}

type State = "default" | "string" | "line" | "block";

/**
 * Remove JSONC comments and trailing commas, preserving string-literal contents.
 * Trailing whitespace/newlines introduced by stripping are harmless to JSON.parse.
 */
function stripJsonc(text: string): string {
  let result = "";
  let i = 0;
  let state: State = "default";
  // A comma is deferred (not emitted) until the next significant char: if that
  // char is `}` or `]`, the comma was trailing and is dropped; otherwise it is
  // flushed first. This keeps commas inside strings untouched (string state
  // bypasses this flag entirely).
  let pendingComma = false;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (state === "string") {
      result += c;
      if (c === "\\") {
        // Keep the escaped char verbatim (e.g. `\"`, `\\`).
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
      // Line comment runs to end of line (newline handled by default state).
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
      // Keep at most one deferred comma; consecutive commas are invalid JSON anyway.
      if (pendingComma) {
        result += ",";
      }
      pendingComma = true;
      i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      // Drop whitespace only while a comma is pending (we re-decide on the next
      // significant char); otherwise preserve it.
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

    // Any other significant character: flush a pending comma, then emit.
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

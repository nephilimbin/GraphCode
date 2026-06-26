/**
 * dependon resource copier.
 *
 * Copies runtime resources that tsc/esbuild do NOT produce:
 *   1. Tree-sitter WASM binaries (core + per-language) from npm packages
 *   2. sql.js WASM
 *   3. Tree-sitter query files (.scm) from the package's own queries/ dir
 *
 * WasmResolver.resolveWasmFile / resolveQueryFile locate these under
 * dist/wasm and dist/queries at runtime, so they must be present post-build.
 *
 * Run via: npm run copy:resources
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nodeModules = (rel) => path.join(root, 'node_modules', rel);
const distWasm = path.join(root, 'dist', 'wasm');
const distQueries = path.join(root, 'dist', 'queries');
const srcQueries = path.join(root, 'queries');

mkdirSync(distWasm, { recursive: true });
mkdirSync(distQueries, { recursive: true });

// [src relative to node_modules, dest filename under dist/wasm]
const wasmFiles = [
  ['web-tree-sitter/web-tree-sitter.wasm', 'tree-sitter.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-typescript.wasm', 'tree-sitter-typescript.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-tsx.wasm', 'tree-sitter-tsx.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-python.wasm', 'tree-sitter-python.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-rust.wasm', 'tree-sitter-rust.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-c_sharp.wasm', 'tree-sitter-c_sharp.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-go.wasm', 'tree-sitter-go.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-java.wasm', 'tree-sitter-java.wasm'],
  ['tree-sitter-wasms/out/tree-sitter-swift.wasm', 'tree-sitter-swift.wasm'],
  ['sql.js/dist/sql-wasm.wasm', 'sqljs.wasm'],
];

let copied = 0;
const missing = [];

for (const [src, dest] of wasmFiles) {
  const srcPath = nodeModules(src);
  const destPath = path.join(distWasm, dest);
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    copied++;
  } else {
    missing.push(src);
  }
}

// Copy .scm query files from the package's own queries/ dir.
const scmFiles = existsSync(srcQueries)
  ? readdirSync(srcQueries).filter((f) => f.endsWith('.scm'))
  : [];

for (const f of scmFiles) {
  copyFileSync(path.join(srcQueries, f), path.join(distQueries, f));
  copied++;
}

console.log(`Resources copied: ${copied} (wasm: ${wasmFiles.length - missing.length}/${wasmFiles.length}, scm: ${scmFiles.length})`);
if (missing.length > 0) {
  console.warn('Missing wasm sources (run npm install first):');
  for (const m of missing) console.warn('  - ' + m);
  process.exit(1);
}

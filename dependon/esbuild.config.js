/**
 * dependon worker bundler.
 *
 * Worker thread scripts (AstWorker, IndexerWorker) run in separate threads and
 * load a single bundled entry. esbuild bundles each into dist/workers/<name>.cjs.
 *
 * Format is **CJS** (not ESM): the workers bundle ts-morph, which uses dynamic
 * `require()` internally — ESM workers reject dynamic require. The package is
 * `type: module`, so workers use the `.cjs` extension so Node loads them as
 * CommonJS (a `.js` would be parsed as ESM under type:module).
 *
 * Run via: npm run build:workers
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

const workers = [
  { entry: 'src/languages/AstWorker.ts', out: 'dist/workers/astWorker.cjs' },
  { entry: 'src/indexing/IndexerWorker.ts', out: 'dist/workers/indexerWorker.cjs' },
];

for (const w of workers) {
  await build({
    entryPoints: [path.join(root, w.entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs', // CJS so dynamic require (ts-morph) works inside the worker
    target: 'node22',
    outfile: path.join(root, w.out),
    sourcemap: true,
    external: ['web-tree-sitter'], // MUST stay external: bundling web-tree-sitter breaks its WASM loading (parser.parse returns null). Matches the main project's worker bundle.
    logLevel: 'info',
  });
}

console.log('Workers bundled:', workers.map((w) => w.out).join(', '));

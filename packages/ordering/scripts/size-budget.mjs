#!/usr/bin/env node
// The package's size budgets, measured on the BUILT output (`pnpm build` first).
//
// The same method as @medalsocial/booking's: esbuild bundles a fixture the
// way a consumer's bundler would (minified, ESM, tree-shaken), with the peers
// external — React and Next are the consumer's, and the SDK appears only as
// erased types — and the result is gzipped.
//
// Raising a budget needs a written reason in the PR. The budget is the
// measurement when it was introduced plus ~15%, capped at the plan's 25 KB.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const EXTERNAL = [
  '@medalsocial/*',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'next',
  'next/*',
  'server-only',
];

const BUDGETS = [
  {
    // Everything `/core` exports: money, links, the draft store, the modifier
    // rules and the label packs. Measured 3.28 KB when introduced.
    name: '@medalsocial/ordering/core — whole entry',
    contents: "export * from './dist/core/index.mjs';",
    gzipBytes: 3.8 * 1024,
  },
];

/** The fixture bundled and minified as a consumer would ship it. */
async function bundled(/** @type {string} */ contents) {
  const result = await build({
    stdin: { contents, resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    external: EXTERNAL,
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].contents;
}

if (!existsSync(join(dist, 'core/index.mjs'))) {
  console.error('[size-budget] dist/ is missing — run `pnpm build` first.');
  process.exit(1);
}

let failed = false;
for (const budget of BUDGETS) {
  const bytes = gzipSync(await bundled(budget.contents)).length;
  const ok = bytes <= budget.gzipBytes;
  failed ||= !ok;
  console.log(
    `[size-budget] ${ok ? 'OK  ' : 'OVER'} ${budget.name}: ${(bytes / 1024).toFixed(2)} KB gzip ` +
      `(budget ${(budget.gzipBytes / 1024).toFixed(1)} KB)`
  );
}
if (failed) process.exit(1);

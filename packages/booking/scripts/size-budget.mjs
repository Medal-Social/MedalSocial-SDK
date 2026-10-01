#!/usr/bin/env node
// The package's size budgets, measured on the BUILT output (`pnpm build` first).
//
// The same method as meda's `scripts/size-budget.mjs`: esbuild bundles a
// fixture the way a consumer's bundler would (minified, ESM, tree-shaken),
// with the peers external — zod is the consumer's, and the SDK appears only as
// erased types — and the result is gzipped. `/react` (P3) joins this list.
//
// Raising a budget needs a written reason in the PR (as in meda's
// CONTRIBUTING.md). Both budgets below were raised from the plan's 10 KB in
// the PR that introduced them: the moved modules are 8.9 KB gzip by this same
// method in the app they came from, before any parameterisation, and P1 moves
// them without refactoring (parity first). Each budget is the measurement at
// 0.1.0 plus ~15%.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const EXTERNAL = ['zod', '@medalsocial/*', 'react', 'react-dom', 'next', 'server-only'];

const BUDGETS = [
  {
    // Everything `/core` exports, config resolution (zod schema) included.
    name: '@medalsocial/booking/core — whole entry',
    contents: "export * from './dist/core/index.mjs';",
    gzipBytes: 16 * 1024,
  },
  {
    // What a booking page's browser bundle pulls in: the wizard and its rules.
    // Config resolution runs on the server; the page receives a resolved config.
    name: '@medalsocial/booking/core — wizard client path',
    contents: `export {
      createWizard, createClock, createMoney, createPhone, createDeepLinks, createStores,
      createRestoreGate, createPartySlots, createIcs, createAge, createDto, createPaths,
      createNextFree, firstOpeningPerResource, stylistDisplayName, initialsOf,
      vippsConfirmFrom, stripVippsReturn,
    } from './dist/core/index.mjs';`,
    gzipBytes: 12.5 * 1024,
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
  console.error('[size-budget] dist/core/index.mjs is missing — run `pnpm build` first.');
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

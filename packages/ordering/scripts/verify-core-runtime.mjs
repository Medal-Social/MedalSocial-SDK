#!/usr/bin/env node
// Checks the BUILT entries keep the promises the source makes, after `pnpm build`:
//
// 1. `dist/core` imports in a bare Node process — no DOM, no bundler, no React —
//    and imports no package at runtime (the SDK is types only and must not
//    appear at runtime at all).
// 2. Every module under `dist/react` starts with the 'use client' directive.
// 3. `dist/next/index.mjs` imports `server-only`, so a client component that
//    reaches for it fails the consumer's build.
//
// The source-level guard is tests/core/boundary.test.ts; this one catches a
// bundler that inlines, renames or reorders something on the way to dist/.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** @type {string[]} */
const errors = [];

/** Every `import`/`export … from` specifier in a built module. */
function specifiersOf(/** @type {string} */ source) {
  return [
    ...source.matchAll(/(?:^|[;\s])(?:import|export)\s*(?:[^'"]*?from\s*)?["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

/** The core entry and every module it reaches through relative imports. */
function coreGraph() {
  const seen = new Set();
  const queue = [join(dist, 'core/index.mjs')];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else errors.push(`dist/core imports «${specifier}» at runtime`);
    }
  }
  return seen;
}

if (!existsSync(join(dist, 'core/index.mjs'))) {
  console.error('[verify-core-runtime] dist/core/index.mjs is missing — run `pnpm build` first.');
  process.exit(1);
}

coreGraph();

if (typeof globalThis.window !== 'undefined' || typeof globalThis.document !== 'undefined') {
  errors.push('this check must run without a DOM');
}
try {
  const core = await import(pathToFileURL(join(dist, 'core/index.mjs')).href);
  if (core.createMoney().formatOre(14_950) !== '149,50 kr')
    errors.push('dist/core: createMoney did not write 14950 øre as «149,50 kr»');
  if (core.parseOrderLink('?t=T7').channel !== 'dine_in')
    errors.push('dist/core: a table link did not read as dine-in');
  if (core.createDraftStore({ site: 'verify' }).loadDraft() !== null)
    errors.push('dist/core: the draft store read a draft without a browser');
} catch (error) {
  errors.push(`dist/core does not import in bare Node: ${String(error)}`);
}

const reactDir = join(dist, 'react');
for (const file of readdirSync(reactDir, { recursive: true })) {
  if (!String(file).endsWith('.mjs')) continue;
  const path = join(reactDir, String(file));
  if (!readFileSync(path, 'utf8').startsWith("'use client';"))
    errors.push(`dist/${relative(dist, path)} lacks its 'use client' directive`);
}

if (!specifiersOf(readFileSync(join(dist, 'next/index.mjs'), 'utf8')).includes('server-only')) {
  errors.push('dist/next/index.mjs does not import server-only');
}

if (errors.length > 0) {
  console.error('\n[verify-core-runtime] FAIL\n');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(
  '[verify-core-runtime] OK — core runs in bare Node, /react is a client entry, /next is server-only.'
);

#!/usr/bin/env node
// Checks the BUILT entries keep the promises the source makes, after `pnpm build`:
//
// 1. `dist/core` imports in a bare Node process — no DOM, no bundler, no React —
//    and imports no package beyond its allowlist (zod; the SDK is types only and
//    must not appear at runtime at all).
// 2. `dist/react/index.mjs` starts with the 'use client' directive.
// 3. Every `dist/next` entry imports `server-only`, so a client component that
//    reaches for one fails the consumer's build.
//
// The source-level guard is tests/core/boundary.test.ts; this one catches a
// bundler that inlines, renames or reorders something on the way to dist/.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const CORE_RUNTIME_ALLOWED = new Set(['zod']);
const NEXT_ENTRIES = [
  'next/index.mjs',
  'next/cache/workers.mjs',
  'next/cache/memory.mjs',
  'next/cache/next-data.mjs',
  'next/cache/noop.mjs',
];

/** @type {string[]} */
const errors = [];

/** Every `import`/`export … from` specifier in a built module. */
function specifiersOf(/** @type {string} */ source) {
  return [
    ...source.matchAll(/(?:^|[;\s])(?:import|export)\s*(?:[^'"]*?from\s*)?["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

/** The core entry and every chunk it reaches through relative imports. */
function coreGraph() {
  const seen = new Set();
  const queue = [join(dist, 'core/index.mjs')];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else if (!CORE_RUNTIME_ALLOWED.has(specifier)) {
        errors.push(`dist/core imports «${specifier}» at runtime`);
      }
    }
  }
  return [...seen];
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
  const config = core.resolveBookingConfig({ timeZone: 'Europe/Oslo' });
  const wizard = core.createWizard(config);
  if (wizard.initialState().step !== 'who')
    errors.push('dist/core: the wizard did not start on step 1');
} catch (error) {
  errors.push(`dist/core does not import in bare Node: ${String(error)}`);
}

const react = readFileSync(join(dist, 'react/index.mjs'), 'utf8');
if (!react.startsWith("'use client';"))
  errors.push("dist/react/index.mjs lacks its 'use client' directive");

for (const entry of NEXT_ENTRIES) {
  if (!specifiersOf(readFileSync(join(dist, entry), 'utf8')).includes('server-only')) {
    errors.push(`dist/${entry} does not import server-only`);
  }
}

if (errors.length > 0) {
  console.error('\n[verify-core-runtime] FAIL\n');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(
  '[verify-core-runtime] OK — core runs in bare Node, /react is a client entry, /next is server-only.'
);

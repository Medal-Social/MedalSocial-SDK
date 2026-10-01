#!/usr/bin/env node
// Checks the BUILT entries keep the promises the source makes, after `pnpm build`:
//
// 1. `dist/core` imports in a bare Node process — no DOM, no bundler, no React —
//    and imports no package beyond its allowlist (zod; the SDK is types only and
//    must not appear at runtime at all).
// 2. Every module under `dist/react` starts with the 'use client' directive,
//    except the server-safe graph of `dist/react/shared.mjs`, which carries
//    none; and the booking page's entry (`dist/react/wizard`) and the
//    layout's (`dist/react/link`) reach neither the manage page nor the portal.
// 3. Every `dist/next` entry imports `server-only`, so a client component that
//    reaches for one fails the consumer's build.
//
// The source-level guard is tests/core/boundary.test.ts; this one catches a
// bundler that inlines, renames or reorders something on the way to dist/.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

/** The built modules `entry` reaches through relative imports, itself included. */
function graphOf(/** @type {string} */ entry, onBare = (/** @type {string} */ _specifier) => {}) {
  const seen = new Set();
  const queue = [join(dist, entry)];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else onBare(specifier);
    }
  }
  return seen;
}

/** The core entry and every module it reaches through relative imports. */
function coreGraph() {
  return graphOf('core/index.mjs', (specifier) => {
    if (!CORE_RUNTIME_ALLOWED.has(specifier))
      errors.push(`dist/core imports «${specifier}» at runtime`);
  });
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

const reactDir = join(dist, 'react');
// `/react/shared` is what a Server Component calls: no directive anywhere in
// its graph, no React, and it imports in bare Node.
const sharedGraph = graphOf('react/shared.mjs', (specifier) => {
  if (specifier !== 'zod') errors.push(`dist/react/shared.mjs reaches «${specifier}» at runtime`);
});
for (const file of readdirSync(reactDir, { recursive: true })) {
  if (!String(file).endsWith('.mjs')) continue;
  const path = join(reactDir, String(file));
  const client = readFileSync(path, 'utf8').startsWith("'use client';");
  const name = relative(dist, path);
  if (sharedGraph.has(path) && client)
    errors.push(`dist/${name} is server-safe but carries 'use client'`);
  if (!sharedGraph.has(path) && !client)
    errors.push(`dist/${name} lacks its 'use client' directive`);
}
for (const entry of ['react/index.mjs', 'react/wizard/index.mjs', 'react/link/index.mjs']) {
  if (!readFileSync(join(dist, entry), 'utf8').startsWith("'use client';"))
    errors.push(`dist/${entry} lacks its 'use client' directive`);
}
// The point of `/react/wizard` and `/react/link`: a booking page, and the
// layout around it, do not ship the rest.
for (const entry of ['react/wizard', 'react/link']) {
  for (const path of graphOf(`${entry}/index.mjs`)) {
    const name = relative(dist, path);
    if (name.startsWith('react/portal/') || name === 'react/ManageBooking.mjs')
      errors.push(`dist/${entry} reaches dist/${name}`);
  }
}
try {
  const { mergeLabels } = await import(pathToFileURL(join(dist, 'react/shared.mjs')).href);
  if (typeof mergeLabels('nb-NO')['who.heading'] !== 'string')
    errors.push('dist/react/shared: mergeLabels gave no pack');
} catch (error) {
  errors.push(`dist/react/shared does not import in bare Node: ${String(error)}`);
}

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
  '[verify-core-runtime] OK — core runs in bare Node, /react, /react/wizard and /react/link are client entries, /react/shared is server-safe, /next is server-only.'
);

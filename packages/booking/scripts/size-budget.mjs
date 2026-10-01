#!/usr/bin/env node
// The package's size budgets, measured on the BUILT output (`pnpm build` first).
//
// The same method as meda's `scripts/size-budget.mjs`: esbuild bundles a
// fixture the way a consumer's bundler would (minified, ESM, tree-shaken),
// with the peers external — zod, React, Next, lucide and meda are the
// consumer's, and the SDK appears only as erased types — and the result is
// gzipped.
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
const EXTERNAL = [
  'zod',
  '@medalsocial/*',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'next',
  'next/*',
  'lucide-react',
  'server-only',
];

/**
 * The build is one module per source module, and `/react`'s modules import
 * `/core`'s under dist/core/. «Own code» leaves those out, because `/core`'s
 * budgets above already gate them; the page budgets below count both.
 */
/** @type {import('esbuild').Plugin} */
const OWN_CODE = {
  name: 'react-own-code',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer.startsWith(join(dist, 'react'))) return undefined;
      const target = resolve(args.resolveDir, args.path);
      return target.startsWith(join(dist, 'core')) ? { path: target, external: true } : undefined;
    });
  },
};

/**
 * What a booking page's browser bundle takes from the `/react` barrel, when
 * the consumer's bundler tree-shakes inside it (esbuild does).
 */
const WIZARD_PAGE = `export {
  BookingWizard, BookingProvider, BookingLink, BookingPendingHost, useNextFree,
} from './dist/react/index.mjs';`;

/** The booking page on its own entry, every export of it kept. */
const WIZARD_ENTRY = "export * from './dist/react/wizard/index.mjs';";

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
  {
    // The plan's budget, on the layer `/react` adds: the wizard, its headless
    // hook, the provider, the login sheet it offers and the booking link. The
    // label packs are NOT in it: the page resolves its pack on the server
    // (`/react/shared`) and passes it as a prop.
    name: '@medalsocial/booking/react — booking page, own code',
    contents: WIZARD_PAGE,
    plugins: [OWN_CODE],
    gzipBytes: 15 * 1024,
  },
  {
    // The same page with the `/core` code it uses. Not in the plan's table:
    // the plan's 15 KB was written for the React layer alone, and the core it
    // sits on is P1's (its client path is gated above). Measured at 0.1.0 plus
    // ~15%, so the two layers cannot grow unnoticed together either.
    name: '@medalsocial/booking/react — booking page, with /core',
    contents: WIZARD_PAGE,
    gzipBytes: 24.5 * 1024,
  },
  {
    // The booking page's own entry, whole: a bundler that keeps a
    // `'use client'` entry as one unit (Turbopack does) ships all of it, so
    // this is the honest measure of the page. It must stay well under the
    // `/react` barrel below; that gap is the manage page and the portal.
    name: '@medalsocial/booking/react/wizard — booking page, own code',
    contents: WIZARD_ENTRY,
    plugins: [OWN_CODE],
    gzipBytes: 15 * 1024,
  },
  {
    name: '@medalsocial/booking/react/wizard — booking page, with /core',
    contents: WIZARD_ENTRY,
    gzipBytes: 24.5 * 1024,
  },
  {
    // Everything `/react` exports, manage page and portal included.
    name: '@medalsocial/booking/react — whole entry, own code',
    contents: "export * from './dist/react/index.mjs';",
    plugins: [OWN_CODE],
    gzipBytes: 20 * 1024,
  },
];

/** The fixture bundled and minified as a consumer would ship it. */
async function bundled(
  /** @type {string} */ contents,
  /** @type {import('esbuild').Plugin[]} */ plugins = []
) {
  const result = await build({
    plugins,
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

if (
  !['core/index.mjs', 'react/index.mjs', 'react/wizard/index.mjs'].every((file) =>
    existsSync(join(dist, file))
  )
) {
  console.error('[size-budget] dist/ is missing — run `pnpm build` first.');
  process.exit(1);
}

let failed = false;
for (const budget of BUDGETS) {
  const bytes = gzipSync(await bundled(budget.contents, budget.plugins)).length;
  const ok = bytes <= budget.gzipBytes;
  failed ||= !ok;
  console.log(
    `[size-budget] ${ok ? 'OK  ' : 'OVER'} ${budget.name}: ${(bytes / 1024).toFixed(2)} KB gzip ` +
      `(budget ${(budget.gzipBytes / 1024).toFixed(1)} KB)`
  );
}
if (failed) process.exit(1);

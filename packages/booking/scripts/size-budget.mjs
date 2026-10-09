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

/**
 * The booking page on its own entries, every export kept: the wizard, and
 * the layout's `/react/link` (booking links, the pending host), which renders
 * on the booking page too.
 */
const WIZARD_ENTRY = `export * from './dist/react/wizard/index.mjs';
export * from './dist/react/link/index.mjs';`;

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
    // Raised 15 → 15.5 KB with the multi-select service step: «Samme som sist»
    // has to join a visit rather than replace it once a person has ticked
    // something, which measured 15.06 KB. Same raise, same reason, as the
    // wizard-entry budget below.
    // Raised 15.5 → 16 KB for `account.required` on top of the multi-select
    // step: the gate that turns «Bekreft» into Vipps / e-post (with the
    // booking it holds and the session-lost notice) and the session handling
    // in submit measured 15.78 KB with both features in.
    // Raised 16 → 16.4 KB for the #181 review round: a login as ANOTHER
    // account over a lost session unseats the previous parent's children
    // (`reseatFor`, keeping the visit and the hour), a draft written while
    // nobody is logged in keeps a saved child by id alone, `account.required`
    // puts each saved child's id back on its line whatever phone was typed,
    // and a lost session keeps the attempt's nonce. Measured 16.11 KB.
    // Raised 16.4 → 16.7 KB for the second review round on account switches over a lost session: only a person id keeps a child seated
    // for the next parent (never a place/name/year match), a guest line's
    // family chip goes with the parent too, the chairs a switch leaves keep
    // their services on a step back (`keptSeats`), and a sent visit rebuilt
    // while nobody is logged in keeps saved children by id alone until the
    // next login claims them (`awaitingIds`). Measured 16.40 KB.
    // Raised 16.7 → 17.5 KB for `config.screens` (bestill phase 2): the
    // recap above the details step with its stylist swap, the two-part
    // summary, the guest party's first seat, and the screen switches.
    // Measured 17.08 KB.
    name: '@medalsocial/booking/react — booking page, own code',
    contents: WIZARD_PAGE,
    plugins: [OWN_CODE],
    gzipBytes: 17.5 * 1024,
  },
  {
    // The same page with the `/core` code it uses. Not in the plan's table:
    // the plan's 15 KB was written for the React layer alone, and the core it
    // sits on is P1's (its client path is gated above). Measured at 0.1.0 plus
    // ~15%, so the two layers cannot grow unnoticed together either.
    // Raised 24.5 → 25.1 KB for the second #181 review round: the hook's code
    // above (it had been 24.47 KB, already at the edge, before it) plus the
    // machine's `seatFamily` `keep` and `unseatPeople` `into`. Measured 24.82 KB.
    // Raised 25.1 → 26 KB for `config.screens` (bestill phase 2): the
    // recap above the details step with its stylist swap, the two-part
    // summary, the guest party's first seat, and the screen switches.
    // Measured 25.56 KB.
    name: '@medalsocial/booking/react — booking page, with /core',
    contents: WIZARD_PAGE,
    gzipBytes: 26 * 1024,
  },
  {
    // The booking page's own entries, whole: a bundler that keeps a
    // `'use client'` entry as one unit (Turbopack does) ships all of each, so
    // this is the honest measure of the page. It must stay well under the
    // `/react` barrel below; that gap is the manage page and the portal.
    // Raised 15 → 15.5 KB for the multi-select service step (meda 3.5's
    // `ServiceScreen` `selection`): the wizard hands it the visit's lists,
    // total, refusal notice and labels — reusing the hook's derived values —
    // and hides its own bar on that step. Measured 15.13 KB.
    // Raised 15.5 → 16.1 KB for `account.required` with the multi-select step:
    // the account gate (booking summary, session-lost notice, focus on
    // re-gate) and the replay that rebuilds a refused visit — extras
    // included — under it. Measured 15.91 KB with both features in.
    // Raised 16.1 → 16.5 KB for the #181 review round, the same code as the
    // page budget above (another account's login unseats the previous
    // parent's children; the lost session keeps the nonce). Measured 16.25 KB.
    // Raised 16.5 → 16.8 KB for the second review round, the same code as the
    // page budget above. Measured 16.53 KB.
    // Raised 16.8 → 17.6 KB for `config.screens` (bestill phase 2): the
    // recap above the details step with its stylist swap, the two-part
    // summary, the guest party's first seat, and the screen switches.
    // Measured 17.23 KB.
    name: '@medalsocial/booking/react/wizard + /react/link — booking page, own code',
    contents: WIZARD_ENTRY,
    plugins: [OWN_CODE],
    gzipBytes: 17.6 * 1024,
  },
  {
    // Raised 24.5 → 24.8 KB for the #181 review round: the hook's code above
    // plus the machine's `unseatPeople` (the previous parent's seats become
    // guest chairs with their services and the hour). Measured 24.53 KB.
    // Raised 24.8 → 25.2 KB for the second review round: the hook's code above
    // plus `seatFamily` `keep` / `unseatPeople` `into`. Measured 24.95 KB.
    // Raised 25.2 → 26.1 KB for `config.screens` (bestill phase 2): the
    // recap above the details step with its stylist swap, the two-part
    // summary, the guest party's first seat, and the screen switches.
    // Measured 25.68 KB.
    name: '@medalsocial/booking/react/wizard + /react/link — booking page, with /core',
    contents: WIZARD_ENTRY,
    gzipBytes: 26.1 * 1024,
  },
  {
    // Everything `/react` exports, manage page and portal included. Raised
    // 20 → 21 KB for several services per person (one visit): the hook's
    // visit-keyed fetching, the extras on drafts and submissions, and the
    // `wizard-error` bridge measured 20.12 KB. The booking page's own budgets
    // above were raised separately (15 → 15.5 KB with the multi-select step,
    // then again for `account.required`) — see their own comments.
    // Raised 21 → 21.3 KB for `account.required` on top of that: the account
    // gate, its labels and the login sheet's throttled notice measured
    // 21.06 KB with both features in.
    // Raised 21.3 → 21.7 KB for the #181 review round — the booking page's
    // own growth above (unseating another account's children, the id-only
    // draft line, the ids under `account.required`). Measured 21.40 KB.
    // Raised 21.7 → 22 KB for the second review round — the booking page's
    // own growth above (only an id keeps a child across an account switch,
    // switched chairs keep their services, a rebuilt visit waits for its
    // child's parent by id). Measured 21.72 KB.
    // Raised 22 → 22.9 KB for `config.screens` (bestill phase 2): the
    // recap above the details step with its stylist swap, the two-part
    // summary, the guest party's first seat, and the screen switches.
    // Measured 22.41 KB.
    name: '@medalsocial/booking/react — whole entry, own code',
    contents: "export * from './dist/react/index.mjs';",
    plugins: [OWN_CODE],
    gzipBytes: 22.9 * 1024,
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
  !['core/index.mjs', 'react/index.mjs', 'react/wizard/index.mjs', 'react/link/index.mjs'].every(
    (file) => existsSync(join(dist, file))
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

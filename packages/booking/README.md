# @medalsocial/booking

The booking product behind a Medal Social booking site: the wizard's rules,
the business's clock, money, phone and deep-link handling, browser stores,
and the customer-portal helpers — built on [`@medalsocial/sdk`](../sdk).

> **Status: pre-release (0.x, not yet published).** `/core` and `/react` are
> in place; `/next` (server loaders, one route handler for every booking and
> portal API route, cache adapters) lands before the first release, `0.1.0`.
> In 0.x a minor version may break; pin the exact version.

## Entry points

| Import | What it is | Runs in |
|---|---|---|
| `@medalsocial/booking/core` | Config, wizard state machine, clock, money, phone, categories, age, party seating, deep links, DTO mapping, ICS, browser stores, portal pure helpers | Browser, Node, Workers — no React, no Next, no DOM at import time |
| `@medalsocial/booking/react` | `<BookingWizard>` and the headless `useBooking()`, `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `<LoginFromQuery>`, `<BookingLink>`, `useNextFree()`, `<BookingProvider>` — composed from `@medalsocial/meda/booking` | Client components (`'use client'`) |
| `@medalsocial/booking/react/shared` | The label packs (`BOOKING_LABELS`, `mergeLabels`) and the portal's URL/cookie readers (`parsePortalTab`, …) | Server Components and the browser — no React |
| `@medalsocial/booking/next` | Reserved (0.1.0): `loadBookingPage`, `createBookingHandler`, portal actions | Server only (`server-only`) |
| `@medalsocial/booking/next/cache/{workers,memory,next-data,noop}` | Reserved (0.1.0): cache adapters | Server only |

ESM only. Peer dependencies: `zod` 4, `react`/`react-dom` 19 (for `/react`),
and optionally `next` ≥ 16.3, `@medalsocial/meda` ^3.2 and `lucide-react` (all
three needed by `/react`).

## Configuration

Everything a site tells the package goes through one client-safe object.
`resolveBookingConfig` fills the defaults, validates with zod and freezes the
result; every factory takes the resolved config.

```ts
import { createClock, createWizard, resolveBookingConfig } from '@medalsocial/booking/core';

export const bookingConfig = resolveBookingConfig({
  timeZone: 'Europe/Oslo', // required
  locale: 'nb-NO',
  currency: 'NOK',
  contact: { name: 'Salong Demo', phone: '22 33 44 55', address: null },
  categories: [
    { key: 'barn', audience: 'child', adultEquivalent: [{ nameIncludes: 'gutt', category: 'herre' }] },
    { key: 'herre', audience: 'adult' },
    { key: 'annet', audience: 'any' },
  ],
  fallbackCategory: 'annet',
  storageNamespace: 'salong-demo',
});

const wizard = createWizard(bookingConfig);
const clock = createClock(bookingConfig);
clock.when(Date.now()); // «i dag 14:15», on the business's clock
```

`BookingConfig` never holds a secret: it is serialised into the page. The
Medal API key, cache adapters and session secret belong to the server options
of `/next`, which read no environment variable themselves — the site passes
its own values in.

| Field | Default | Purpose |
|---|---|---|
| `timeZone` | — (required) | IANA zone of the business's opening hours; every clock face uses it |
| `locale` | `nb-NO` | `Intl` formatting and the built-in label pack (`nb` or `en`) |
| `currency` | `NOK` | ISO 4217; amounts stay in minor units on the wire |
| `phone` | `{ country: 'NO', validate: 'strict' }` | `NO` is the only strict rule set in 0.x |
| `paths` | `/bestill`, `/bestill/administrer`, `/min-side`, `/api/booking`, … | The URLs the site serves |
| `query` / `whoValues` | `kategori`, `tjeneste`, `frisor`, `antall`, `hvem`, … | Deep-link query keys and values |
| `categories` / `fallbackCategory` | `barn` (child), `annet` (any) | Service groups in display order; unknown Medal categories land on the fallback |
| `party` | `{ maxPeople: 3, allowParallel: true, askWhoFirst: true }` | Step 1's rules |
| `window` | `{ rangeDays: 7, prefetchLimit: 4, prefetchCategory: null }` | Bookable window and page prefetch |
| `dayparts` | `formiddag` 0–12, `ettermiddag` 12–17, `kveld` 17–24 | Named parts of the day, contiguous from 0 to 24 |
| `portal` | disabled; cookie `booking_portal` (+ derived `_next`, `__Host-…_vipps_bind`, `_vipps_link`) | Customer portal switches and cookie names |
| `consent` | `{ termsUrl: null, marketing: null }` | The marketing sentence and its version are the site's own |
| `storageNamespace` | `medal` | Browser keys are `<ns>:booking:draft`, `<ns>:booking:attempt`, `<ns>:booking:rebook-who` |
| `ics` | `-//Medal Social//Booking//EN` | Calendar product id and UID domain |
| `labels` | built-in pack for `locale` | Partial copy overrides (`summary.pickTime`, `daypart.<key>`, …) |

A site moving onto the package keeps its live sessions, drafts and cache
entries by passing the paths, cookie names and storage namespace it already
uses.

## The UI (`/react`)

The screens are meda's; the package feeds them. A site needs Tailwind v4 and
meda's stylesheets (`@import '@medalsocial/meda/styles/bridge.css'` and
`@import '@medalsocial/meda/booking/styles.css'`), and themes them with its
own shadcn variables (`--primary`, `--card`, …).

```tsx
// app/bestill/page.tsx — a Server Component
import { resolveBookingConfig } from '@medalsocial/booking/core';
import { BookingWizard } from '@medalsocial/booking/react';
import { mergeLabels } from '@medalsocial/booking/react/shared';
import { startLogin, startVipps } from './actions'; // the app's 'use server' wrappers

const config = resolveBookingConfig({
  timeZone: 'Europe/Oslo',
  // Resolved here, so the browser bundle carries no copy it does not show.
  labels: mergeLabels('nb-NO', { 'who.heading': 'Hvem gjelder timen?' }),
});

export default async function Page() {
  const seed = await loadSeed(); // `/next`'s loader
  return <BookingWizard config={config} seed={seed} actions={{ startLogin, startVipps }} />;
}
```

The override ladder, cheapest first, all public API:

1. **CSS variables** — the bridge's shadcn names.
2. **`labels`** — any key of `BookingLabels`, over the pack in `config.labels`.
3. **`classNames`** — per screen and slot: `classNames={{ who: { chip: '…' }, time: { chip: '…' } }}`.
4. **`components`** — card renderers: `components={{ ServiceCard, StylistCard, TimeChip, … }}`.
5. **`useBooking()`** — the wizard's whole state, fetches and actions, without its markup.

`<BookingProvider config labels classNames components>` shares one set of
these with every booking piece under it. Server actions stay in the app
(`PortalActions`): each is a three-line `'use server'` wrapper passed in as a
prop, answering with its result or with next-safe-action's envelope.

## Development

```bash
pnpm --filter @medalsocial/booking test          # node + jsdom projects
pnpm --filter @medalsocial/booking test:coverage # 100% thresholds
pnpm --filter @medalsocial/booking build
pnpm --filter @medalsocial/booking verify:paths  # export map + bare-Node core check
pnpm --filter @medalsocial/booking size:budget   # gzip budgets, esbuild-bundled
```

`/core` may import nothing from React, Next, `server-only` or meda — Biome's
`noRestrictedImports` and `tests/core/boundary.test.ts` both enforce it. This
repository is public: no customer names, copy or data in any file
(`tests/core/denylist.test.ts`).

## License

Apache-2.0

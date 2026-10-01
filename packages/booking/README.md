# @medalsocial/booking

The booking product behind a Medal Social booking site: the wizard's rules,
the business's clock, money, phone and deep-link handling, browser stores,
and the customer-portal helpers — built on [`@medalsocial/sdk`](../sdk).

> **Status: pre-release (0.x, not yet published).** `/core` is in place;
> `/react` (the wizard, manage page and portal, composed from
> `@medalsocial/meda/booking`) and `/next` (server loaders, one route handler
> for every booking and portal API route, cache adapters) are reserved entries
> that land before the first release, `0.1.0`. In 0.x a minor version may
> break; pin the exact version.

## Entry points

| Import | What it is | Runs in |
|---|---|---|
| `@medalsocial/booking/core` | Config, wizard state machine, clock, money, phone, categories, age, party seating, deep links, DTO mapping, ICS, browser stores, portal pure helpers | Browser, Node, Workers — no React, no Next, no DOM at import time |
| `@medalsocial/booking/react` | Reserved (0.1.0): `<BookingWizard>`, `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `useBooking()` | Client components (`'use client'`) |
| `@medalsocial/booking/next` | Reserved (0.1.0): `loadBookingPage`, `createBookingHandler`, portal actions | Server only (`server-only`) |
| `@medalsocial/booking/next/cache/{workers,memory,next-data,noop}` | Reserved (0.1.0): cache adapters | Server only |

ESM only. Peer dependencies: `zod` 4, `react`/`react-dom` 19 (for `/react`),
and optionally `next` ≥ 16.3 and `@medalsocial/meda` ^3.2.

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

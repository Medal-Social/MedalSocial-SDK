# @medalsocial/booking

The booking product behind a Medal Social booking site: the wizard's rules,
the business's clock, money, phone and deep-link handling, browser stores,
and the customer-portal helpers — built on [`@medalsocial/sdk`](../sdk).

> **Status: pre-release (0.x, not yet published).** `/core`, `/react` and
> `/next` are in place for the first release, `0.1.0`. In 0.x a minor version
> may break; pin the exact version.

## Entry points

| Import | What it is | Runs in |
|---|---|---|
| `@medalsocial/booking/core` | Config, wizard state machine, clock, money, phone, categories, age, party seating, deep links, DTO mapping, ICS, browser stores, portal pure helpers | Browser, Node, Workers — no React, no Next, no DOM at import time |
| `@medalsocial/booking/react` | `<BookingWizard>` and the headless `useBooking()`, `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `<LoginFromQuery>`, `<BookingLink>`, `useNextFree()`, `<BookingProvider>` — composed from `@medalsocial/meda/booking` | Client components (`'use client'`) |
| `@medalsocial/booking/react/wizard` | The booking page's entry: `<BookingWizard>`, `useBooking()`, `<BookingProvider>`, `<LoginSheet>` — and none of the manage page or the portal. Import a booking page from here | Client components (`'use client'`) |
| `@medalsocial/booking/react/link` | What a layout mounts outside the booking page: `<BookingLink>`, `<BookingPendingHost>`, `useNextFree()`, `<BookingProvider>`. A root layout renders on the booking page too, so import it from here | Client components (`'use client'`) |
| `@medalsocial/booking/react/shared` | The label packs (`BOOKING_LABELS`, `mergeLabels`) and the portal's URL/cookie readers (`parsePortalTab`, …) | Server Components and the browser — no React |
| `@medalsocial/booking/next` | `createBookingServer`: one handler for every booking and portal API route, the page loaders (`loadBookingPage`, `loadManagePage`, `loadPortalPage`), portal session and action functions, the Medal seam | Server only (`server-only`), Next ≥ 16.3 |
| `@medalsocial/booking/next/cache/{workers,memory,next-data,noop}` | Cache adapters: Workers Cache API, in-process LRU, Next's data cache, none | Server only |

ESM only, one built module per source module, `"sideEffects": false`, so a
bundler keeps only the modules a page reaches. A bundler keeps a `'use client'`
entry whole, though (Turbopack does), so `/react` brings everything it exports
to the page that imports it: use `/react/wizard` on a booking page and
`/react/link` in the layout around it, and keep `/react` for pages where size
does not matter.

Peer dependencies: `zod` 4, `react`/`react-dom` 19 (for `/react`),
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
| `party` | `{ maxPeople: 3, allowParallel: true, askWhoFirst: true, maxServicesPerPerson: 1 }` | Step 1's rules; `maxServicesPerPerson` (1–4) caps one person's visit: `1` is the one-tap service step, above `1` the wizard's service step is multi-select (tick up to that many, then «Neste») |
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
three of meda's stylesheets, and themes them with its own shadcn variables
(`--primary`, `--card`, …):

```css
@import '@medalsocial/meda/styles/bridge.css';
@import '@medalsocial/meda/primitives/styles.css'; /* the sheets and dialogs the screens open */
@import '@medalsocial/meda/booking/styles.css';
```

Without the primitives sheet the login sheet's positioning classes are never
generated, and it opens at the top of the page.

```tsx
// app/bestill/page.tsx — a Server Component
import { resolveBookingConfig } from '@medalsocial/booking/core';
import { BookingWizard } from '@medalsocial/booking/react/wizard';
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
2. **`labels`** — any key of `BookingLabels`, over the pack in `config.labels`
   (see [Labels and text nodes](#labels-and-text-nodes)).
3. **`classNames`** — per screen and slot: `classNames={{ who: { chip: '…' }, time: { chip: '…' } }}`.
4. **`components`** — card renderers: `components={{ ServiceCard, StylistCard, TimeChip, … }}`.
5. **`useBooking()`** — the wizard's whole state, fetches and actions, without its markup. Several services per person: `toggleServiceFor(index, service)` ticks or unticks one (never advances) and `continueFromService()` moves on to the time step — for a multi-select service step; `pickService`/`pickServiceFor` keep the one-tap behaviour.

`<BookingProvider config labels classNames components>` shares one set of
these with every booking piece under it. Server actions stay in the app
(`PortalActions`): each is a three-line `'use server'` wrapper passed in as a
prop, answering with its result or with next-safe-action's envelope.

### Labels and text nodes

A label is a `BookingLabel`: a `string` or an array of strings. Both forms are
serialisable and work for every key. They differ only in the DOM they render as:

- A **string** is ONE text node once its `{holes}` are filled, the way a
  template literal is.
- An **array** is one text node per element, each element filled with the same
  values. For example, `['Steg ', '{step}', ' av ', '{total}']` is four nodes,
  the DOM of `Steg {step} av {total}` written out in JSX. An element that fills
  to `''` renders nothing.

A browser lays text out per text node, so a site moving onto these screens
from its own JSX can match its old pixels by writing each sentence in the shape
its old markup had. Text-only targets read an array joined: `aria-label`, the
calendar file, its name, and messages.

The built-in packs are strings, except the three sentences the package itself
draws in pieces: `wizard.progress`, `wizard.slotsUnavailable.call` and
`portal.greeting`. `wizard.party.sizeWord.two` / `.three` / `.other` spell the
party size («to», «tre», «flere») for `{sizeWord}` in the stylist step's
`stylist.party.parallel.*` and `stylist.party.parallelNote.*`. Left blank, the
number is filled in instead. An array for a meda screen key needs
`@medalsocial/meda` 3.4 or later.

## Server (`/next`)

```ts
// lib/booking/server.ts
import 'server-only';
import { createBookingServer } from '@medalsocial/booking/next';
import { nextDataCacheAdapter } from '@medalsocial/booking/next/cache/next-data';
import { workersCacheAdapter } from '@medalsocial/booking/next/cache/workers';

export const booking = createBookingServer({
  config: bookingConfig,
  // Functions, so the key is read per request (OpenNext fills process.env late).
  medal: { apiKey: () => process.env.MEDAL_API_KEY, baseUrl: () => process.env.MEDAL_API_ENDPOINT },
  cache: {
    edge: workersCacheAdapter({ origin: () => process.env.NEXT_PUBLIC_BASE_URL }),
    data: nextDataCacheAdapter(),
    prefix: 'my-site-booking',
    environment: 'production',
  },
});

// app/api/booking/[...path]/route.ts and app/api/portal/[...path]/route.ts
export const { GET, POST, DELETE } = booking.handler;
```

- **Pages** call `booking.loadBookingPage({ searchParams })`,
  `booking.loadManagePage(token)` and `booking.loadPortalPage()`; each answers
  a tagged result (`redirect`, `unavailable`, `ready`, …) and the page renders it.
- **Server actions stay in the app.** `booking.portal.actions.*` are plain async
  functions; wrap each in a `'use server'` export and pass it to the components.
- **Caches.** `edge` holds the booking seed (per location, a few ms); `data`
  holds services, stylists, hours and free slots. On Node use
  `memoryCacheAdapter()` for both. Every adapter keeps one contract
  (`tests/next/cache/contract.test.ts`).
- **Stylist photos.** `/api/booking/avatar/<id>` fetches a stylist's photo
  server-side and serves it from the site with a day of browser cache. It
  fetches only from `avatarHosts` (exact names or `*.` suffixes; default
  `DEFAULT_AVATAR_HOSTS`, Medal's photo storage and Google profile pictures),
  over `https:` on the default port, never from an IP address or internal
  name and never through a redirect, and it relays only JPEG, PNG, WebP, AVIF
  and GIF. A photo anywhere else falls back to the stylist's initials.
- `examples/next-booking` is a runnable site on plain `next start`.

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

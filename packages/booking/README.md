# @medalsocial/booking

The booking product behind a Medal Social booking site: the wizard's rules,
the business's clock, money, phone and deep-link handling, browser stores,
and the customer-portal helpers — built on [`@medalsocial/sdk`](../sdk).

> **Status: pre-release (0.x), published on npm.** `/core`, `/react` and
> `/next` are stable enough to build a site on, but in 0.x a minor version may
> break; pin the exact version.

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
and optionally `next` ≥ 16.3, `@medalsocial/meda` ^3.13 and `lucide-react` (all
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
| `party` | `{ maxPeople: 3, allowParallel: true, askWhoFirst: true, maxServicesPerPerson: 1, adultTogether: false, guestStartEmpty: false }` | Step 1's rules; `maxServicesPerPerson` (1–4) caps one person's visit: `1` is the one-tap service step, above `1` the wizard's service step is multi-select (tick up to that many, then «Neste»). `adultTogether` starts a party with a grown-up in it «Samtidig» (side by side) until the parent picks a mode or names one stylist; needs `allowParallel`. `guestStartEmpty` (with `screens.guestParty`) starts a guest's step 1 with nobody rather than one child, so a grown-up alone is one tap |
| `window` | `{ rangeDays: 7, prefetchLimit: 4, prefetchCategory: null, followPolicy: false }` | Bookable window and page prefetch; `followPolicy` uses the saved limit (see below) |
| `dayparts` | `formiddag` 0–12, `ettermiddag` 12–17, `kveld` 17–24 | Named parts of the day, contiguous from 0 to 24 |
| `portal` | disabled; cookie `booking_portal` (+ derived `_next`, `__Host-…_vipps_bind`, `_vipps_link`) | Customer portal switches and cookie names |
| `contact` | `{ phone: null, address: null, name: '', mapsUrl: null }` | The business's own contact; `mapsUrl` is the booked screen's directions link (`null` searches a map for `address`) |
| `policy` | `{ freeChangeHours: null }` | A change or cancellation is free until this many hours before; the booked screen and the desktop panel say so |
| `consent` | `{ termsUrl: null, marketing: null }` | The marketing sentence and its version are the site's own |
| `screens` | every switch `false` | Opt-in screen features, below; nothing changes for a site that sets none |
| `storageNamespace` | `medal` | Browser keys are `<ns>:booking:draft`, `<ns>:booking:attempt`, `<ns>:booking:rebook-who` |
| `ics` | `-//Medal Social//Booking//EN` | Calendar product id and UID domain |
| `labels` | built-in pack for `locale` | Partial copy overrides (`summary.pickTime`, `daypart.<key>`, …) |

### Follow the saved booking horizon

Set `window.followPolicy: true` to use the workspace booking setting instead of a fixed `rangeDays`. The server loads `GET /api/v1/bookings/policy` on each booking-page request; a saved value of 90 includes the last partially bookable date. The API still enforces the exact cutoff. Requests use the existing bounded availability chunks, and cached seeds are separated by saved limit and calendar span. If policy loading fails, the page reports unavailable rather than showing a stale fixed limit. Deploy the policy API before enabling this option on a site.

Policy-following pages prefetch at most 31 calendar days. Prefetched openings are immediately usable; selecting a service starts sequential reads of at most 31 days for the remaining slots, hours and stylist openings. The existing calendar grows as dates are answered, so unread dates cannot appear fully booked. If a later read fails, known dates stay usable and retry resumes the unread range. A retry after midnight, a new booking attempt or a taken-slot response retires stale openings. Anonymous policy read routes and normalized cache reads enforce the same 31-day bound (plus the DST hour). Availability and schedule reads recheck the live policy before using cached data, key by the saved limit, and clamp the final partial day; a failed policy read fails closed. Taken-slot recovery returns a bounded fresh prefix with its exclusive end timestamp, and the client reads the remaining horizon normally. The next-free banner describes the bounded prefetched window.

### Opt-in screens (`screens`)

Each switch turns on one screen feature (needs `@medalsocial/meda` ^3.13, the peer range). The
built-in packs carry their words; override them with `labels`.

| Switch | What the parent sees |
|---|---|
| `recap` | The details step opens with what is being booked: a calendar leaf, the hours, each person's services and stylist, the total, «Endre» back to the time step, and — when «first available» picked one stylist while others were free at that minute — a one-tap swap (`recap.*`) |
| `soonest` | «Ledig snart» above the days: the three earliest starts across the window, one tap each, with who it would be with (`time.soonest.*`) |
| `dayFullness` | Each day chip shows how much room it has, or «fullt» for an open day searched for everyone (`time.dayChip.*`) |
| `summaryDetail` | The sticky bar's time and price on a second line, so a phone's ellipsis does not eat them |
| `hideDisabledNext` | The bar's «Neste» only while it does something; the step's hint in its place (`summary.hint.*`) |
| `firstAvailableFaces` | «Første ledige» drawn as the faces of the stylists who can do the basket |
| `stylistEdgeFade` | The phone's sideways stylist row fades at its edge |
| `guestParty` | A guest picks a number of children and «me too» instead of the chips, so a parent and child book together without an account; the step opens with one child seated (also in the server render) (`who.party.*`) |
| `childMenuFirst` | A child's service list leads with the children's and anyone's groups; grown-ups' groups move below the «usually not for this age» divider |
| `wideLayouts` | The stylist step keeps its row of faces at every width, with the chosen stylist's bio under it; the time step puts the days beside the times on an iPad and shows the week as a grid of times on a desktop (`time.week.*` labels) |
| `seatStylists` | A family seen at once can ask for a stylist per person («who cuts whom», `stylist.party.seat*` labels); the rest are seated with anyone free at that minute |
| `adultStepper` | With `guestParty`, «adult» is a number beside «children» (two grown-ups in one booking), `who.party.adult*` labels. A logged-in parent's «Meg selv» row is the same stepper (`who.family.adults`), «Meg selv» its first seat, so a second grown-up survives a login, an account switch and a resumed draft. The step's lead (`who.party.lead`) and «come along» hint (`who.party.togetherHint`) are empty in the built-in packs: a site writes them for its own `maxPeople` |
| `compactHeader` | The header is one line of crumbs carrying the answers so far («1 child · What»), with no title over the step's question |
| `serviceSearch` | A grown-up's service list gets a search field (`service.search*` labels) |
| `bookedHero` | The confirmation leads with the day as a large leaf, calendar and directions buttons and until when a change is free (`contact.mapsUrl`, `policy.freeChangeHours`) |
| `desktopPanel` | From `lg` up, a sticky «your appointment» panel beside the step replaces the summary bar (`panel.*`, `wizard.panel.*` labels) |

A site moving onto the package keeps its live sessions, drafts and cache
entries by passing the paths, cookie names and storage namespace it already
uses.

## The UI (`/react`)

The screens are meda's; the package feeds them. A site needs Tailwind v4,
three of meda's stylesheets and a `@source` for this package's own components,
and themes them with its own shadcn variables (`--primary`, `--card`, …):

```css
@import '@medalsocial/meda/styles/bridge.css';
@import '@medalsocial/meda/primitives/styles.css'; /* the sheets and dialogs the screens open */
@import '@medalsocial/meda/booking/styles.css';
/* The wizard's own layout around meda's screens. Relative to this file. */
@source '../node_modules/@medalsocial/booking/dist/react';
```

Without the primitives sheet the login sheet's positioning classes are never
generated, and it opens at the top of the page. Without the `@source` (Tailwind
does not scan `node_modules`), the classes only this package uses are never
generated either: the desktop «your appointment» column
(`screens.desktopPanel`) then drops under the step. Point it at wherever your
install puts the package, e.g. the repository root's `node_modules` in a
hoisted monorepo.

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

### Synthetic monitoring (`data-testid`)

`<BookingWizard>` stamps stable `data-testid` values for promote gates and
uptime checks. Import `BOOKING_TEST_IDS` from `@medalsocial/booking/react/wizard`
(or `/react`). Naming: `booking-` prefix, then the role.

| `data-testid` | Where |
|---|---|
| `booking-step-who` | Who step container |
| `booking-step-service` | Service step container |
| `booking-step-stylist` | Stylist / barber half of the when step |
| `booking-step-calendar` | Day strip + slot list (and empty / error) |
| `booking-service-option` | Each service card (`data-service-id`) |
| `booking-stylist-option` | Each stylist card (`data-resource-id`, or `first`) |
| `booking-day` | Each day-strip chip (`data-day-ts`) |
| `booking-slot` | Each time chip (`data-start-ts`) |
| `booking-slots-error` | Availability could not be read |
| `booking-slots-empty` | Selected day has nothing free |

`booking-day` is on the day strip (the primary picker). The optional month grid
shows the same days. Site `components` overrides stay wrapped so the ids remain.

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
- **Calendar files.** `/api/booking/calendar/<token>[,<token>…]` serves the
  visit as `text/calendar`, in place, so iOS and macOS open «Add to Calendar»
  instead of saving a file. Everything in it is the server's: each event's
  time, end and UID read from Medal by its manage token, the title and change
  link from the `ics.*` labels (set your words in the server config's `labels`;
  the wizard's `wizard.ics.*` only shape the `data:` fallback and Google
  Calendar), the place from `contact.address` (set it in the server config for
  a location). Only manage-token-shaped segments reach Medal,
  a family's tokens are read at once under one 10 s deadline, and each token
  past the first counts against `rateLimit`. `no-store`, `no-referrer`.
  The confirmation links to it per device: the file on Apple devices and
  desktops (Google Calendar beside it), Google Calendar on Android (the file
  beside it). Google never receives the change link. A family's visit is always
  the file — Google takes one event per link.
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

# @medalsocial/booking

## 0.8.0

### Minor Changes

- [#244](https://github.com/Medal-Social/MedalSocial-SDK/pull/244) [`13b838e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/13b838e525b296bc4efc1e61a63c1c9f3234a49f) Thanks [@adaadev](https://github.com/adaadev)! - Expose the workspace's public booking horizon and add `window.followPolicy` to let booking pages follow the saved setting. Policy-aware pages include the boundary date, isolate seeds by horizon, and fail closed when the setting cannot be read. Static window configurations remain compatible.

### Patch Changes

- [#244](https://github.com/Medal-Social/MedalSocial-SDK/pull/244) [`13b838e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/13b838e525b296bc4efc1e61a63c1c9f3234a49f) Thanks [@adaadev](https://github.com/adaadev)! - Recheck the saved horizon before cached booking reads, retire stale policy entries, and keep normalized upstream requests within the bounded read limit.

- [#244](https://github.com/Medal-Social/MedalSocial-SDK/pull/244) [`13b838e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/13b838e525b296bc4efc1e61a63c1c9f3234a49f) Thanks [@adaadev](https://github.com/adaadev)! - README: a site's stylesheet needs `@source` for the package's `dist/react`. Tailwind does not scan `node_modules`, so without it the classes only this package uses (the desktop panel's column grid) are never generated.

- [#244](https://github.com/Medal-Social/MedalSocial-SDK/pull/244) [`13b838e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/13b838e525b296bc4efc1e61a63c1c9f3234a49f) Thanks [@adaadev](https://github.com/adaadev)! - Stable `data-testid` attributes on the wizard steps and key controls (`BOOKING_TEST_IDS`) for synthetic monitoring and promote gates: step containers, each service / stylist / day / slot option, and the slots error and empty states. No visual or behaviour change.
- Updated dependencies [[`13b838e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/13b838e525b296bc4efc1e61a63c1c9f3234a49f)]:
  - @medalsocial/sdk@1.16.0

## 0.7.0

### Minor Changes

- [#234](https://github.com/Medal-Social/MedalSocial-SDK/pull/234) [`08a265e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/08a265e689aaa5766b03d45afe5b4c83a36c1b3a) Thanks [@adaadev](https://github.com/adaadev)! - «Add to calendar» works on phones. The confirmation no longer links a `data:` file (which iPhones saved to Files, in-app browsers blocked and Android's Google Calendar cannot open): a new route `<api>/calendar/<tokens>` serves the visit as `text/calendar` in place, built entirely on the server (Medal by the bookings' manage tokens, the new `ics.*` labels, `contact.address`), and the link is chosen per device — the file on Apple devices and desktops with Google Calendar beside it, Google Calendar on Android with the file beside it. A confirmation saved before this keeps the `data:` file. Needs `@medalsocial/meda` 3.12 (`calendarAlt`, `calendarNewTab`); peer range `^3.12.0`.

- [#234](https://github.com/Medal-Social/MedalSocial-SDK/pull/234) [`08a265e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/08a265e689aaa5766b03d45afe5b4c83a36c1b3a) Thanks [@adaadev](https://github.com/adaadev)! - A second grown-up stays in the booking under a family. With `screens.adultStepper`, a logged-in parent's step 1 draws «Voksne» as the same stepper a guest's does (meda 3.13, new `who.family.adults` label in the built-in packs), with «Meg selv» as its first seat. `isGuestSeat` no longer claims `adult:2` and up, so a guest who picks two grown-ups and then logs in keeps both, a switch to another account keeps them, and a resumed draft seats its grown-ups as «Meg selv» and `adult:2` rather than as children. A calendar event whose end Medal could not give is written without `DTEND`, an instant, instead of a zero-length event (RFC 5545 wants DTEND after DTSTART). Needs `@medalsocial/meda` 3.13; peer range `^3.13.0`.

- [#234](https://github.com/Medal-Social/MedalSocial-SDK/pull/234) [`08a265e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/08a265e689aaa5766b03d45afe5b4c83a36c1b3a) Thanks [@adaadev](https://github.com/adaadev)! - The redesign's remaining screens, each behind a `config.screens` switch (all off by default): `adultStepper` (grown-ups as a number beside the children, so two grown-ups book together), `compactHeader` (one line of crumbs carrying the answers, no title over the question), `serviceSearch` (a search field on a grown-up's list), `bookedHero` (the confirmation with a large day leaf, calendar and directions buttons and until when a change is free) and `desktopPanel` (a sticky «your appointment» panel beside the step from `lg` up). New config: `contact.mapsUrl` and `policy.freeChangeHours`. Fixes a restored guest party coming back with every person after the first as a child. Needs `@medalsocial/meda` 3.11.

## 0.6.0

### Minor Changes

- [#228](https://github.com/Medal-Social/MedalSocial-SDK/pull/228) [`f35636a`](https://github.com/Medal-Social/MedalSocial-SDK/commit/f35636acb4e3cbe7f8d5c453e2fe4ba82ec3421c) Thanks [@adaadev](https://github.com/adaadev)! - `party.guestStartEmpty`: with `screens.guestParty`, a guest's step 1 starts with nobody instead of one child, and the child stepper goes down to 0, so a grown-up booking only for themselves is one tap. «Next» waits for an answer. Off by default. The meda peer range is now `^3.10.0`.

## 0.5.0

### Minor Changes

- [#222](https://github.com/Medal-Social/MedalSocial-SDK/pull/222) [`685a4fb`](https://github.com/Medal-Social/MedalSocial-SDK/commit/685a4fb45914f3d8ce9a02c6092faa98b7455d7b) Thanks [@adaadev](https://github.com/adaadev)! - Config `screens.seatStylists` (default `false`): when a family is seen at once, each person can ask for their own stylist («who cuts whom»), and the search seats everyone else with whoever is free at that minute. New `WizardState.seatResourceIds` and `pickSeatResource` action, kept in drafts and dropped when the basket changes. `findPartySlots` takes per-seat preferences. Built-in nb/en `stylist.party.seat*` words.
  
  Requires `@medalsocial/meda` ^3.9.0.

### Patch Changes

- [#222](https://github.com/Medal-Social/MedalSocial-SDK/pull/222) [`685a4fb`](https://github.com/Medal-Social/MedalSocial-SDK/commit/685a4fb45914f3d8ce9a02c6092faa98b7455d7b) Thanks [@adaadev](https://github.com/adaadev)! - A person who replaces someone on step 1 no longer inherits that person's «who cuts whom» stylist. A choice only moves to a new seat key when a login renames the same person.

- [#222](https://github.com/Medal-Social/MedalSocial-SDK/pull/222) [`685a4fb`](https://github.com/Medal-Social/MedalSocial-SDK/commit/685a4fb45914f3d8ce9a02c6092faa98b7455d7b) Thanks [@adaadev](https://github.com/adaadev)! - The stylist step's «who cuts whom» seats are passed only while the party is seen at once. One after another is one stylist for the whole visit, so the wizard no longer depends on the screen hiding them.

## 0.4.1

### Patch Changes

- [#214](https://github.com/Medal-Social/MedalSocial-SDK/pull/214) [`6afacff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/6afacffc461213b95a02951f15638d3d42c1975e) Thanks [@alioftech](https://github.com/alioftech)! - Outage-hardening follow-ups: every failed visit in a party's batch reaches `onEvent` as its own `read_error` (the controller's `readError` is now `readErrors`, a short queue). An overnight «Prøv igjen» shows the stylists loading until the new window answers. Portal refusals are logged with their `reason` code.

- [#214](https://github.com/Medal-Social/MedalSocial-SDK/pull/214) [`6afacff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/6afacffc461213b95a02951f15638d3d42c1975e) Thanks [@alioftech](https://github.com/alioftech)! - Outage hardening after a production incident where the DST hour pushed the widest booking window past the routes' 62 × 24 h range guard, so every unseeded service answered 400 between 00:00 and 01:00 for eight weeks of nights.
  
  - The read routes admit the widest window a valid config can build, DST hour included. One module (`core/range.ts`, exporting `MAX_RANGE_DAYS` and `MAX_RANGE_MS`) owns the bound for the config schema, `parseRange` and the catalogue cache horizon.
  - «Prøv igjen» re-reads the openings, the stylists and the hours, seeded ones included. If the business day has moved on, it starts a fresh window from now. A party keeps the visits that answered and asks only for the ones that failed.
  - Medal's `in_past`, `outside_horizon` and `off_grid` refusals take the slot-taken path (fresh openings, back to the time step) rather than an endless «Prøv en gang til».
  - Every answer ≥ 400 is logged through the site's logger with the route (a fixed label for malformed or unmatched paths), method, status and error code. The message is never logged, and neither are the rate limiter's own 429s. `onEvent` gains `{ type: 'read_error', endpoint, status }`, once per failure.
  - Catalogue and calendar reads give up after 4 s per attempt and 8 s in total, instead of the SDK's 30 s × 3 with an uncapped `Retry-After`. The deadline aborts the SDK call itself, so nothing more is sent upstream.
  - A booking that happened is never answered as a failure because a cache could not be expired.
  - A pending booking resumes on browsers without `AbortSignal.timeout` (Safari < 16).

- [#214](https://github.com/Medal-Social/MedalSocial-SDK/pull/214) [`6afacff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/6afacffc461213b95a02951f15638d3d42c1975e) Thanks [@alioftech](https://github.com/alioftech)! - `isSlotTaken` reads Medal's «pick another time» refusals defensively: any 409 (not only code `CONFLICT`), `details.reason` in any case, and the message prefix when there is no reason. A change of spelling on the engine side now degrades to fresh openings, never to a retry loop.
- Updated dependencies [[`6afacff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/6afacffc461213b95a02951f15638d3d42c1975e)]:
  - @medalsocial/sdk@1.15.0

## 0.4.0

### Minor Changes

- [#212](https://github.com/Medal-Social/MedalSocial-SDK/pull/212) [`7504690`](https://github.com/Medal-Social/MedalSocial-SDK/commit/75046906f272e3e0c74d97801cc06d9825020c74) Thanks [@adaadev](https://github.com/adaadev)! - Config `screens.wideLayouts` (default `false`): the stylist step keeps its row of faces at every width, with the chosen stylist's bio under it, and the time step uses the adaptive layout. On an iPad the days sit beside the times; on a desktop the whole week is a grid of times. Built-in nb/en words for `time.week.none` and `time.week.more`.
  
  Requires `@medalsocial/meda` ^3.8.0.

- [#212](https://github.com/Medal-Social/MedalSocial-SDK/pull/212) [`7504690`](https://github.com/Medal-Social/MedalSocial-SDK/commit/75046906f272e3e0c74d97801cc06d9825020c74) Thanks [@adaadev](https://github.com/adaadev)! - Config `party.adultTogether` (default `false`): a party with a grown-up in it starts «Samtidig», side by side, and goes back to «Rett etter hverandre» when the grown-up leaves it. It stops deciding once the parent picks a mode or a party slot, and a party with a named stylist stays one after another, including a stylist a link names after the party is seated («Første ledige» gives «Samtidig» back). A restored draft keeps a mode the parent picked; one the default picked stays the default's. New optional `WizardState.partyModeChosen` and `WizardDraft.partyModeChosen`.

## 0.3.1

### Patch Changes

- [#204](https://github.com/Medal-Social/MedalSocial-SDK/pull/204) [`2e9425a`](https://github.com/Medal-Social/MedalSocial-SDK/commit/2e9425a78d4ed5871f8c0b607b6afa9b668c44bc) Thanks [@adaadev](https://github.com/adaadev)! - The time step's «now» starts at the seed window (`slots.fromTs`) for the server render and the first client paint, so a deferred chunk no longer hydrates on a later clock (React [#418](https://github.com/Medal-Social/MedalSocial-SDK/issues/418)). It then follows the wall clock every minute, so a wizard left open across midnight stops calling yesterday «I dag».

## 0.3.0

### Minor Changes

- [#197](https://github.com/Medal-Social/MedalSocial-SDK/pull/197) [`4312a91`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4312a911666bf08dd68385bb5d168a43b9fa951e) Thanks [@adaadev](https://github.com/adaadev)! - Config `account.required`: booking only for a logged-in parent; `/create` answers 401 `accountRequired` without a session and forwards the portal session to Medal; the wizard's details step becomes «Fortsett med Vipps» / «Fortsett med e-post» until the parent is logged in (the e-mail then read-only, a session lost before submit shows the login again with the time kept), and the login page shows the same two buttons.
  
  Requires `@medalsocial/meda` ^3.7.0 (this release's floor; the gate itself first needs 3.6.0 for the `emailCollapsed` login, `login.continueEmail`, `details.email.lockedHelp` and the `emailButton` slot).

- [#197](https://github.com/Medal-Social/MedalSocial-SDK/pull/197) [`4312a91`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4312a911666bf08dd68385bb5d168a43b9fa951e) Thanks [@adaadev](https://github.com/adaadev)! - Config `screens`: opt-in screen features, every switch off by default. `recap` puts meda's `BookingRecap` above the details step (day, hours, who, stylist, total, «Endre», and a swap to another stylist free at the same minute when «first available» picked one); `soonest` and `dayFullness` turn on the time step's «Ledig snart» row and day marks; `summaryDetail` and `hideDisabledNext` give the bar a second line and a hint in place of a dead «Neste»; `firstAvailableFaces` and `stylistEdgeFade` draw «Første ledige» as the stylists' faces and fade the phone row; `guestParty` lets a guest book children and themselves together (step 1 opens with one child seated, in the server render too); `childMenuFirst` moves the grown-ups' groups below a child's age divider. New `wizard.summaryParts`, built-in nb/en words for every new key, and `screenLabels` returns every key required.
  
  Requires `@medalsocial/meda` ^3.7.0.

### Patch Changes

- [#197](https://github.com/Medal-Social/MedalSocial-SDK/pull/197) [`4312a91`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4312a911666bf08dd68385bb5d168a43b9fa951e) Thanks [@adaadev](https://github.com/adaadev)! - A login as another account never keeps the previous parent's child: only a shared person id keeps a seat (not a place, name and year match), and a saved child a family chip put on a guest line goes too. The guest chairs an account switch leaves keep their services when the parent steps back to the service step. A sent visit rebuilt after a lost session while nobody is logged in keeps saved children by id alone: the next login gets their own child back by id, anybody else a blank chair. New optional machine fields: `seatFamily.keep` and `unseatPeople.into`.

- [#200](https://github.com/Medal-Social/MedalSocial-SDK/pull/200) [`4c521ef`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4c521ef89769ec85bf83bd4fb3339e712e99a8ee) Thanks [@adaadev](https://github.com/adaadev)! - A login whose profile could not be read no longer falls back to the parent the page arrived as: the family list goes, and the name, phone and e-mail that parent's profile filled in are cleared, so the next parent never books with the previous account's details. A field the visitor filled or changed stays theirs through any later logins, even typed back to the profile's value; a field the previous profile filled is emptied when the next profile has nothing for it. The children's seats that login let go keep their ids out of sight, so a parent who then logs in with a readable profile gets their own child back (by id only); anyone else keeps a blank chair.

- [#197](https://github.com/Medal-Social/MedalSocial-SDK/pull/197) [`4312a91`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4312a911666bf08dd68385bb5d168a43b9fa951e) Thanks [@adaadev](https://github.com/adaadev)! - Picking a stylist again does not keep their previous open days after that read fails, and a retry is not marked settled while it is still in flight.
- Updated dependencies [[`4312a91`](https://github.com/Medal-Social/MedalSocial-SDK/commit/4312a911666bf08dd68385bb5d168a43b9fa951e)]:
  - @medalsocial/sdk@1.14.0

## 0.2.1

### Patch Changes

- [#189](https://github.com/Medal-Social/MedalSocial-SDK/pull/189) [`352b030`](https://github.com/Medal-Social/MedalSocial-SDK/commit/352b030d1fbae39a8fdb82bc454b967f6821ac58) Thanks [@alioftech](https://github.com/alioftech)! - A named stylist's calendar follows that stylist's open days. «First available» keeps the salon's. The seeded schedule is the salon's week and no longer answers once a stylist is chosen; the wizard refetches `/schedule` with `resource_id`.

## 0.2.0

### Minor Changes

- [#185](https://github.com/Medal-Social/MedalSocial-SDK/pull/185) [`ecf1912`](https://github.com/Medal-Social/MedalSocial-SDK/commit/ecf1912b4029c2faf3aca3e005c4b7f9183f53a1) Thanks [@alioftech](https://github.com/alioftech)! - Several services per person as one visit: the wizard machine holds a person's extra services, the site routes take `extra_service_ids` on availability, schedule and stylists and `extraServiceIds` on create, and `useBooking()` fetches, seats, submits, stashes and confirms the whole visit. New hook actions `toggleServiceFor(index, service)` and `continueFromService()` are ready for a multi-select service screen.
  
  `<BookingWizard>` draws meda 3.5's multi-select service step when `party.maxServicesPerPerson` is above `1`: each person ticks up to that many services, the step's own bar shows the visit's total, and «Neste» moves on once everyone has one. The default is `1`, the one-tap step every site has today. The meda peer is now `^3.5.0`.

### Patch Changes

- Updated dependencies [[`ecf1912`](https://github.com/Medal-Social/MedalSocial-SDK/commit/ecf1912b4029c2faf3aca3e005c4b7f9183f53a1)]:
  - @medalsocial/sdk@1.13.0

## 0.1.0

### Minor Changes

- [#174](https://github.com/Medal-Social/MedalSocial-SDK/pull/174) [`3f5475e`](https://github.com/Medal-Social/MedalSocial-SDK/commit/3f5475e6c667e9de0c625331e050cb2f8c790f3a) Thanks [@alioftech](https://github.com/alioftech)! - New package `@medalsocial/booking` (0.1.0): a complete, themeable booking product for Medal customer sites.
  
  - `@medalsocial/booking/core` — the booking wizard's state machine and rules, the business's clock, money and phone formatting, service categories, age, party seating, deep links, Medal DTO mapping, ICS export, browser stores and customer-portal helpers, all driven by one validated, client-safe `BookingConfig` (`resolveBookingConfig`).
  - `@medalsocial/booking/react` — `<BookingWizard>` (on the headless `useBooking()`), `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `<BookingLink>` and `<BookingProvider>`, composed from `@medalsocial/meda/booking` screens; server-safe label packs in `/react/shared`. A booking page imports from `@medalsocial/booking/react/wizard` (the wizard, `useBooking()`, the provider and the login sheet, without the manage page or the portal) and its layout from `@medalsocial/booking/react/link` (`<BookingLink>`, `<BookingPendingHost>`, `useNextFree()`); the build is one module per source module with `"sideEffects": false`.
  - Labels: every key takes a `BookingLabel`, a string (one text node once filled) or an array of strings (one text node per element), so a site decides where each sentence breaks into text nodes; `fill`, `fillParts`, `labelText` and `isBookingLabel` in `/core`. The built-in packs are strings except `wizard.progress`, `wizard.slotsUnavailable.call` and `portal.greeting`; `wizard.party.sizeWord.*` spells the party size for meda's `{sizeWord}`.
  - `@medalsocial/booking/next` — `createBookingServer()`: one route handler for every booking and portal API route, page loaders, portal action functions, and cache adapters (`/next/cache/workers`, `/next/cache/next-data`, `/next/cache/memory`, `/next/cache/noop`). The stylist-photo proxy fetches only from `avatarHosts` (default `DEFAULT_AVATAR_HOSTS`) and relays only raster images; a Vipps login grant is exchanged only in the browser that started the login.
  
  Pre-1.0: a minor bump may break in 0.x; pin the exact version.

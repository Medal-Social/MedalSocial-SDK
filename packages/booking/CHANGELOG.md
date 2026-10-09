# @medalsocial/booking

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

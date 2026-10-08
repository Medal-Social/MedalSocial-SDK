# @medalsocial/booking

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

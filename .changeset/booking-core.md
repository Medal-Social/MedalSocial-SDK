---
"@medalsocial/booking": minor
---

New package `@medalsocial/booking` (0.1.0): a complete, themeable booking product for Medal customer sites.

- `@medalsocial/booking/core` — the booking wizard's state machine and rules, the business's clock, money and phone formatting, service categories, age, party seating, deep links, Medal DTO mapping, ICS export, browser stores and customer-portal helpers, all driven by one validated, client-safe `BookingConfig` (`resolveBookingConfig`).
- `@medalsocial/booking/react` — `<BookingWizard>` (on the headless `useBooking()`), `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `<BookingLink>` and `<BookingProvider>`, composed from `@medalsocial/meda/booking` screens; server-safe label packs in `/react/shared`. A booking page imports from `@medalsocial/booking/react/wizard` (the wizard, `useBooking()`, the provider and the login sheet, without the manage page or the portal) and its layout from `@medalsocial/booking/react/link` (`<BookingLink>`, `<BookingPendingHost>`, `useNextFree()`); the build is one module per source module with `"sideEffects": false`.
- Labels: every key takes a `BookingLabel`, a string (one text node once filled) or an array of strings (one text node per element), so a site decides where each sentence breaks into text nodes; `fill`, `fillParts`, `labelText` and `isBookingLabel` in `/core`. The built-in packs are strings except `wizard.progress`, `wizard.slotsUnavailable.call` and `portal.greeting`; `wizard.party.sizeWord.*` spells the party size for meda's `{sizeWord}`.
- `@medalsocial/booking/next` — `createBookingServer()`: one route handler for every booking and portal API route, page loaders, portal action functions, and cache adapters (`/next/cache/workers`, `/next/cache/next-data`, `/next/cache/memory`, `/next/cache/noop`).

Pre-1.0: a minor bump may break in 0.x; pin the exact version.

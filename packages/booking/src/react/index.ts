/**
 * `@medalsocial/booking/react` — the booking UI, composed from the
 * `@medalsocial/meda/booking` screens.
 *
 * - `<BookingWizard>` (and the headless `useBooking()` it is built on),
 *   `<ManageBooking>`, `<PortalDashboard>`, `<LoginSheet>`, `<LoginPageQuery>`
 *   and `<BookingLink>`.
 * - `<BookingProvider>`: one config, label pack and set of overrides for every
 *   piece under it.
 * - The portal action contract (`PortalActions`) and the label types. The
 *   packs themselves (`BOOKING_LABELS`, `mergeLabels`) are in
 *   `@medalsocial/booking/react/shared`, a server-safe entry: resolve the pack
 *   on the server and pass it in (`config.labels` or `labels`), so the
 *   browser bundle carries no copy it does not show.
 *
 * The override ladder, cheapest first: CSS variables → `labels` →
 * `classNames` per screen slot → `components` (card renderers) →
 * `useBooking()`.
 *
 * A convenience barrel, not for a performance-critical page: a bundler keeps
 * a `'use client'` entry whole, so a page importing anything from here ships
 * the manage page and the portal too. A booking page imports from
 * `@medalsocial/booking/react/wizard`, and a layout's booking links
 * from `@medalsocial/booking/react/link`.
 *
 * Needs Next.js ≥ 16.3 (`next/navigation`, `next/link`) and three of meda's
 * stylesheets in a Tailwind v4 build: `@medalsocial/meda/styles/bridge.css`,
 * `@medalsocial/meda/primitives/styles.css` (the sheets the screens open) and
 * `@medalsocial/meda/booking/styles.css`.
 */

export * from './actions';
export * from './BookingLink';
export * from './BookingWizard';
export * from './kit';
export * from './LoginPageQuery';
export * from './LoginSheet';
export type {
  BookingLabels,
  BookingLabelsInput,
  LoginLabels,
  ManageLabels,
  PortalLabels,
  ScreenLabels,
  WizardLabels,
} from './labels';
export * from './ManageBooking';
export * from './PortalDashboard';
export * from './Provider';
export * from './use-next-free';
export * from './useBooking';

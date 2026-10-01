/**
 * `@medalsocial/booking/react/link` — the booking pieces that sit OUTSIDE the
 * booking page: `<BookingLink>`, the `<BookingPendingHost>` a root layout
 * mounts, `useNextFree()` for a «next free time» teaser, and the
 * `<BookingProvider>` they read their config from.
 *
 * A root layout renders on every route, the booking page included, so what it
 * imports ships there too. Import it from here, not from the `/react` barrel,
 * which a bundler keeps whole (manage page and portal included). This entry
 * and `/react/wizard` share their modules, so a page that uses both carries
 * the provider once.
 */

export * from '../BookingLink';
export type { BookingOverrides } from '../Provider';
export { BookingProvider, useBookingKit } from '../Provider';
export * from '../use-next-free';

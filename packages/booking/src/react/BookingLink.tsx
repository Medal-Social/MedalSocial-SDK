import { BookingSkeleton } from '@medalsocial/meda/booking';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ComponentProps, type MouseEvent, useEffect, useRef, useState } from 'react';
import type { BookingConfig } from '../core/config';
import { type BookingOverrides, useBookingKit } from './Provider';
import { screenLabels } from './screen-labels';

/**
 * Every in-site link into the booking page, so the one tap a site exists for
 * never waits on a blank screen.
 *
 * PREFETCH. The booking page is dynamic, and a dynamic route with no
 * `loading.js` is prefetched only down to its layout. So the bare booking
 * path is prefetched in FULL (`prefetch`), once per page view however many
 * buttons point at it. A deep link (`?kategori=barn`) is a different URL and
 * a different server render, and a home page may carry a dozen, so those
 * switch to a full prefetch only on intent — hover, or the touch that starts a
 * tap.
 *
 * FEEDBACK. A route `loading.tsx` would stream a shell before the page runs,
 * and a booking page that hands off to another provider answers with a
 * redirect: the shell would turn it into a client redirect after a flash. So
 * `:active` presses the button in the tap's frame, and while the navigation is
 * still pending `BookingPendingHost` draws the booking frame over the page.
 */

type PathsConfig = Pick<BookingConfig, 'paths'>;

/** A link into the booking page, with or without a query; `null` for anything else. */
export function bookingTarget(href: string, config: PathsConfig): 'bare' | 'deep' | null {
  const path = config.paths.booking;
  if (href === path) return 'bare';
  return href.startsWith(`${path}?`) ? 'deep' : null;
}

/** The `next/link` prefetch props for one href. */
export function bookingPrefetch(
  href: string,
  config: PathsConfig
): { prefetch?: boolean; unstable_dynamicOnHover?: boolean } {
  const target = bookingTarget(href, config);
  if (target === 'bare') return { prefetch: true };
  if (target === 'deep') return { unstable_dynamicOnHover: true };
  return {};
}

/** Fired by a booking link on a plain tap; heard by `BookingPendingHost`. */
export const BOOKING_NAVIGATION_EVENT = 'medal-booking:navigation';
/** A navigation that lands inside this never shows the frame at all. */
export const PENDING_DELAY_MS = 120;
/** A navigation that never lands (offline, aborted) stops covering the page. */
export const PENDING_TIMEOUT_MS = 12_000;

/** Only a tap the router will handle in this tab: not ⌘/ctrl/shift-click. */
function isPlainTap(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * Draws the booking frame (meda's `BookingSkeleton`) for a navigation into
 * the booking page that is taking a moment, and removes it when the route
 * lands.
 *
 * In the root layout, not in the link: the link that was tapped may be gone
 * before the navigation is — a menu overlay closes on the same tap — and the
 * frame has to outlive it. Shown only after `PENDING_DELAY_MS`, so a
 * prefetched navigation (the usual case) never flashes it.
 */
export function BookingPendingHost(props: BookingOverrides) {
  const { kit, classNames } = useBookingKit(props);
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
    const start = () => {
      clear();
      timers.current = [
        window.setTimeout(() => setVisible(true), PENDING_DELAY_MS),
        window.setTimeout(() => setVisible(false), PENDING_TIMEOUT_MS),
      ];
    };
    const stop = () => {
      clear();
      setVisible(false);
    };
    window.addEventListener(BOOKING_NAVIGATION_EVENT, start);
    window.addEventListener('popstate', stop);
    return () => {
      clear();
      window.removeEventListener(BOOKING_NAVIGATION_EVENT, start);
      window.removeEventListener('popstate', stop);
    };
  }, []);

  // The route landed (or the visitor went elsewhere): the frame's job is done.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on arrival, keyed by the path.
  useEffect(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setVisible(false);
  }, [pathname]);

  return visible ? (
    <BookingSkeleton labels={screenLabels(kit.labels)} classNames={classNames.skeleton} />
  ) : null;
}

export type BookingLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch' | 'href'> & {
  href: string;
  /** The site's config; or the nearest `BookingProvider`'s. */
  config?: Readonly<BookingConfig>;
};

/**
 * `next/link` for a booking destination. Anything that is not the booking
 * page — a landing page, the price list — passes straight through, so callers
 * can hand it whatever their CMS field holds.
 */
export function BookingLink({
  href,
  children,
  onClick,
  target,
  config,
  ...rest
}: BookingLinkProps) {
  const paths = useBookingKit({ config }).kit.config;
  const booking = bookingTarget(href, paths) !== null;
  return (
    <Link
      href={href}
      target={target}
      {...bookingPrefetch(href, paths)}
      onClick={(event) => {
        onClick?.(event);
        // Unless we are already there: no navigation is coming to end it.
        if (
          booking &&
          !target &&
          isPlainTap(event) &&
          window.location.pathname !== paths.paths.booking
        ) {
          window.dispatchEvent(new Event(BOOKING_NAVIGATION_EVENT));
        }
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}

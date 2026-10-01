/**
 * The link every «Bestill time» goes through.
 *
 * Two promises worth pinning: the bare wizard is prefetched in full while a
 * deep link waits for intent (one server render per page view, not a dozen),
 * and a tap whose navigation is still pending shows the booking frame at once
 * instead of leaving the page frozen.
 */

import { act, fireEvent, render as renderInDom, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/' }));

vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
const linkProps = vi.hoisted(() => ({ last: {} as Record<string, unknown> }));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    unstable_dynamicOnHover,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean; unstable_dynamicOnHover?: boolean }) => {
    linkProps.last = { href, prefetch, unstable_dynamicOnHover };
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

import {
  BOOKING_NAVIGATION_EVENT,
  BookingLink,
  BookingPendingHost as Host,
  PENDING_DELAY_MS,
  PENDING_TIMEOUT_MS,
  bookingPrefetch as prefetchFor,
  bookingTarget as targetOf,
} from '../../../src/react/BookingLink';
import { BookingProvider } from '../../../src/react/Provider';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

/** Everything under the parity config, whose booking page is `/bestill`. */
function Parity({ children }: { children: ReactNode }) {
  return (
    <BookingProvider config={PARITY_CONFIG} labels={TEST_LABELS}>
      {children}
    </BookingProvider>
  );
}
const render = (ui: ReactElement) => renderInDom(ui, { wrapper: Parity });
const BookingPendingHost = () => <Host />;
const bookingTarget = (href: string) => targetOf(href, PARITY_CONFIG);
const bookingPrefetch = (href: string) => prefetchFor(href, PARITY_CONFIG);

beforeEach(() => {
  linkProps.last = {};
});

describe('bookingTarget', () => {
  it('tells the bare wizard from a deep link, and both from anything else', () => {
    expect(bookingTarget('/bestill')).toBe('bare');
    expect(bookingTarget('/bestill?kategori=barn')).toBe('deep');
    expect(bookingTarget('/bestill/administrer/abc')).toBeNull();
    expect(bookingTarget('/bestillinger')).toBeNull();
    expect(bookingTarget('/priser')).toBeNull();
    expect(bookingTarget('https://booking.example.test/demo')).toBeNull();
  });
});

describe('bookingPrefetch', () => {
  it('prefetches the bare wizard in full', () => {
    expect(bookingPrefetch('/bestill')).toEqual({ prefetch: true });
  });

  it('waits for hover or touch on a deep link', () => {
    expect(bookingPrefetch('/bestill?frisor=stylist-1')).toEqual({ unstable_dynamicOnHover: true });
  });

  it('leaves every other link to the default', () => {
    expect(bookingPrefetch('/barnehage')).toEqual({});
  });
});

describe('BookingLink', () => {
  it('hands next/link the prefetch policy for its href', () => {
    render(<BookingLink href="/bestill">Bestill time</BookingLink>);
    expect(linkProps.last).toMatchObject({ href: '/bestill', prefetch: true });

    render(<BookingLink href="/bestill?kategori=barn">Bestill for barn</BookingLink>);
    expect(linkProps.last).toMatchObject({
      href: '/bestill?kategori=barn',
      prefetch: undefined,
      unstable_dynamicOnHover: true,
    });
  });

  it('tells the host a booking navigation started on a plain tap', () => {
    const heard = vi.fn();
    window.addEventListener(BOOKING_NAVIGATION_EVENT, heard);
    render(<BookingLink href="/bestill">Bestill time</BookingLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Bestill time' }), { button: 0 });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(BOOKING_NAVIGATION_EVENT, heard);
  });

  it('stays quiet for a ⌘-click, a new tab, or a link that is not the wizard', () => {
    const heard = vi.fn();
    window.addEventListener(BOOKING_NAVIGATION_EVENT, heard);
    render(
      <>
        <BookingLink href="/bestill">Bestill time</BookingLink>
        <BookingLink href="/bestill" target="_blank">
          Ny fane
        </BookingLink>
        <BookingLink href="/barnehage">Barnehage</BookingLink>
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Bestill time' }), { metaKey: true });
    fireEvent.click(screen.getByRole('link', { name: 'Ny fane' }));
    fireEvent.click(screen.getByRole('link', { name: 'Barnehage' }));
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(BOOKING_NAVIGATION_EVENT, heard);
  });
});

describe('BookingPendingHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pathname.value = '/';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never flashes for a navigation that lands at once', () => {
    const { rerender } = render(<BookingPendingHost />);
    act(() => {
      window.dispatchEvent(new Event(BOOKING_NAVIGATION_EVENT));
    });
    pathname.value = '/bestill';
    rerender(<BookingPendingHost />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS + 50);
    });
    expect(screen.queryByTestId('booking-pending')).toBeNull();
  });

  it('draws the booking frame for a slow navigation, and removes it when the route lands', () => {
    const { rerender } = render(<BookingPendingHost />);
    act(() => {
      window.dispatchEvent(new Event(BOOKING_NAVIGATION_EVENT));
      vi.advanceTimersByTime(PENDING_DELAY_MS + 10);
    });
    const frame = screen.getByTestId('booking-pending');
    expect(frame).toHaveAttribute('role', 'status');
    expect(frame).toHaveTextContent('Åpner timebestillingen');

    pathname.value = '/bestill';
    rerender(<BookingPendingHost />);
    expect(screen.queryByTestId('booking-pending')).toBeNull();
  });

  it('gives up covering the page when the navigation never lands', () => {
    render(<BookingPendingHost />);
    act(() => {
      window.dispatchEvent(new Event(BOOKING_NAVIGATION_EVENT));
      vi.advanceTimersByTime(PENDING_TIMEOUT_MS + 10);
    });
    expect(screen.queryByTestId('booking-pending')).toBeNull();
  });
});

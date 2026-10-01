import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKING_NAVIGATION_EVENT,
  BookingLink,
  BookingPendingHost,
  bookingPrefetch,
  PENDING_DELAY_MS,
} from '../../../src/react/BookingLink';
import { PARITY_CONFIG } from '../../support/parity-config';
import { SECOND_CONFIG } from '../../support/second-config';

/** The booking path comes from the config, and only a plain tap announces. */

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    unstable_dynamicOnHover: _hover,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean; unstable_dynamicOnHover?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const heard = vi.fn();
beforeEach(() => {
  heard.mockReset();
  window.addEventListener(BOOKING_NAVIGATION_EVENT, heard);
});
afterEach(() => {
  window.removeEventListener(BOOKING_NAVIGATION_EVENT, heard);
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('BookingLink, another site', () => {
  it('reads the booking path from its config', () => {
    expect(bookingPrefetch('/book', SECOND_CONFIG)).toEqual({ prefetch: true });
    expect(bookingPrefetch('/book?category=kids', SECOND_CONFIG)).toEqual({
      unstable_dynamicOnHover: true,
    });
    expect(bookingPrefetch('/bestill', SECOND_CONFIG)).toEqual({});
  });
});

describe('BookingLink, the tap', () => {
  const link = (props: Partial<React.ComponentProps<typeof BookingLink>> = {}) => {
    render(
      <BookingLink href="/bestill" config={PARITY_CONFIG} className="cta" {...props}>
        Bestill time
      </BookingLink>
    );
    return screen.getByRole('link', { name: 'Bestill time' });
  };

  it('passes its own props through and calls the caller’s onClick', () => {
    const onClick = vi.fn();
    const anchor = link({ onClick });
    expect(anchor).toHaveClass('cta');
    fireEvent.click(anchor, { button: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a ctrl-click', { ctrlKey: true }],
    ['a shift-click', { shiftKey: true }],
    ['an alt-click', { altKey: true }],
    ['a middle click', { button: 1 }],
  ])('stays quiet for %s', (_case, init) => {
    fireEvent.click(link(), init);
    expect(heard).not.toHaveBeenCalled();
  });

  it('stays quiet when the caller prevented the navigation', () => {
    fireEvent.click(link({ onClick: (event) => event.preventDefault() }));
    expect(heard).not.toHaveBeenCalled();
  });

  it('stays quiet on the booking page itself: no navigation will end the frame', () => {
    window.history.replaceState(null, '', '/bestill');
    fireEvent.click(link());
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('BookingPendingHost, overrides and Back', () => {
  it('draws meda’s skeleton with the site’s words and classNames, and Back removes it', () => {
    vi.useFakeTimers();
    render(
      <BookingPendingHost
        config={PARITY_CONFIG}
        labels={{ 'bookingSkeleton.opening': 'Laster …' }}
        classNames={{ skeleton: { root: 'my-frame' } }}
      />
    );
    act(() => {
      window.dispatchEvent(new Event(BOOKING_NAVIGATION_EVENT));
      vi.advanceTimersByTime(PENDING_DELAY_MS + 10);
    });
    const frame = screen.getByTestId('booking-pending');
    expect(frame).toHaveClass('my-frame');
    expect(frame).toHaveTextContent('Laster …');

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByTestId('booking-pending')).toBeNull();
  });
});

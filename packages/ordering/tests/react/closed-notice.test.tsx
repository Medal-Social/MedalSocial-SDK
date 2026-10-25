import { act, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClosedNotice } from '../../src/react/ClosedNotice';
import { axeViolations } from '../support/axe';

/** Wednesday 22 October 2026, 09:30 in Oslo (CEST, UTC+2). */
const NOW = new Date('2026-10-22T07:30:00Z');

describe('ClosedNotice', () => {
  it('closed shows next opening', () => {
    render(<ClosedNotice nextOpenAt="2026-10-22T09:00:00Z" now={NOW} locale="nb" />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Restauranten tar ikke imot bestillinger nå.');
    expect(notice).toHaveTextContent('Åpner kl. 11:00');
  });

  it('says «i morgen» for tomorrow and the weekday later in the week', () => {
    const { rerender } = render(
      <ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" now={NOW} locale="nb-NO" />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Åpner i morgen kl. 11:00');
    rerender(<ClosedNotice nextOpenAt={Date.parse('2026-10-24T09:00:00Z')} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Åpner lørdag kl. 11:00');
    // A week or more away: the date, not a weekday that would read as this week.
    rerender(<ClosedNotice nextOpenAt={new Date('2026-11-03T10:00:00Z')} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Åpner 3. november kl. 11:00');
  });

  it('reads the day in the restaurant’s time zone, not the viewer’s', () => {
    // 23:30 UTC on the 22nd is already the 23rd in Oslo, and still the 22nd in New York.
    render(
      <ClosedNotice
        nextOpenAt="2026-10-23T02:00:00Z"
        now={new Date('2026-10-22T23:30:00Z')}
        timeZone="America/New_York"
        locale="en"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Opens at 22:00');
  });

  it('writes English', () => {
    const { rerender } = render(
      <ClosedNotice nextOpenAt="2026-10-22T09:00:00Z" now={NOW} locale="en-GB" />
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('The restaurant is not taking orders right now.');
    expect(notice).toHaveTextContent('Opens at 11:00');
    rerender(<ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" now={NOW} locale="en" />);
    expect(notice).toHaveTextContent('Opens tomorrow at 11:00');
    rerender(<ClosedNotice nextOpenAt="2026-10-23T22:15:00Z" now={NOW} locale="en" />);
    expect(notice).toHaveTextContent('Opens Saturday at 00:15');
    rerender(<ClosedNotice nextOpenAt="2026-11-03T10:00:00Z" now={NOW} locale="en" />);
    expect(notice).toHaveTextContent('Opens 3 November at 11:00');
  });

  it('says only that it is closed without a next opening, or with one that is past or unreadable', () => {
    const cases = [undefined, null, '2026-10-22T07:00:00Z', 'not a date'];
    for (const nextOpenAt of cases) {
      const { unmount } = render(<ClosedNotice nextOpenAt={nextOpenAt} now={NOW} />);
      expect(screen.getByRole('status')).toHaveTextContent(
        /^Restauranten tar ikke imot bestillinger nå\.$/
      );
      unmount();
    }
  });

  it('uses the clock when no `now` is given, and a site’s own words', () => {
    render(
      <ClosedNotice
        id="closed"
        nextOpenAt={Date.now() + 60_000}
        labels={{ closed: 'Stengt.', opensToday: 'Opp {time}' }}
      />
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('id', 'closed');
    expect(notice).toHaveTextContent(/^Stengt\.Opp \d\d:\d\d$/);
  });

  it('renders no opening on the server without `now`, and the client adds it after hydrating', async () => {
    const element = <ClosedNotice nextOpenAt={Date.now() + 60 * 60_000} />;
    const html = renderToString(element);
    expect(html).toContain('Restauranten tar ikke imot bestillinger nå.');
    expect(html).not.toContain('Åpner');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await act(async () => hydrateRoot(container, element, { onRecoverableError }));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container).toHaveTextContent(/Åpner kl\. \d\d:\d\d/);
    consoleError.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  it('moves the opening line on at midnight and drops it once open, without a `now`', () => {
    // 23:59:30 in Oslo on Thursday 22 October; opens Friday 11:00.
    vi.useFakeTimers({ now: new Date('2026-10-22T21:59:30Z') });
    try {
      const { unmount } = render(<ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" />);
      const notice = screen.getByRole('status');
      expect(notice).toHaveTextContent('Åpner i morgen kl. 11:00');
      act(() => vi.advanceTimersByTime(29_000));
      expect(notice).toHaveTextContent('Åpner i morgen kl. 11:00');
      act(() => vi.advanceTimersByTime(1_000));
      expect(notice).toHaveTextContent('Åpner kl. 11:00');
      expect(notice).not.toHaveTextContent('i morgen');
      // Right at the opening the line goes, even between two minutes.
      act(() => vi.setSystemTime(new Date('2026-10-23T08:59:59.500Z')));
      act(() => vi.advanceTimersByTime(60_000));
      expect(notice).toHaveTextContent(/^Restauranten tar ikke imot bestillinger nå\.$/);
      // Nothing left to move on: no timer, and none after unmounting.
      expect(vi.getTimerCount()).toBe(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops its timer on unmount, and sets none with a fixed `now`', () => {
    vi.useFakeTimers({ now: new Date('2026-10-22T21:59:30Z') });
    try {
      const { unmount } = render(<ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" />);
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      render(<ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" now={NOW} />);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no axe violations', async () => {
    const { container } = render(<ClosedNotice nextOpenAt="2026-10-23T09:00:00Z" now={NOW} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

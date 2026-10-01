/**
 * «Neste ledige» for a booking button — for the site's own booking page only,
 * fetched after idle, re-asked when its minute is up or the quoted time starts.
 *
 * The first two tests are the hook's half of the source's sticky-bar suite
 * (the bar itself stays in the app): the same fetch, timers and assertions,
 * through a probe that draws what the bar drew.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXT_FREE_TTL_MS } from '../../../src/core/next-free';
import { nextFreeClient, useNextFree } from '../../../src/react/use-next-free';
import { PARITY_CONFIG } from '../../support/parity-config';
import { SECOND_CONFIG } from '../../support/second-config';

const fetchMock = vi.fn();
const answer = (startTs: number) =>
  new Response(JSON.stringify({ startTs, label: 'i dag 11:00' }), { status: 200 });

function Probe({ enabled = true }: { enabled?: boolean }) {
  const nextFree = useNextFree(enabled, PARITY_CONFIG);
  return (
    <a href="/bestill">
      <span>Bestill time</span>
      {nextFree && <span>· neste ledige {nextFree.label}</span>}
    </a>
  );
}

async function idle(ms = 2_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  nextFreeClient(PARITY_CONFIG).resetNextFree();
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StickyBookingBar «neste ledige»', () => {
  it('adds the next free time to the button once the page is idle', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ startTs: Date.now() + 3_600_000, label: 'i dag 11:00' }), {
        status: 200,
      })
    );
    render(<Probe />);
    expect(screen.getByRole('link')).toHaveTextContent(/^Bestill time$/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/booking/next-free');
    expect(screen.getByRole('link')).toHaveTextContent('Bestill time· neste ledige i dag 11:00');
  });

  it('asks nothing when bookings are handed to another provider', async () => {
    render(<Probe enabled={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link')).toHaveTextContent(/^Bestill time$/);
  });
});

describe('useNextFree', () => {
  it('shares one client per site, and asks each site’s own endpoint', () => {
    expect(nextFreeClient(PARITY_CONFIG)).toBe(nextFreeClient(PARITY_CONFIG));
    expect(nextFreeClient(SECOND_CONFIG).endpoint).toBe('/api/book/next-free');
  });

  it('drops a quoted time once it has started, and asks again then', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer(Date.now() + 5_000)));
    render(<Probe />);
    await idle();
    expect(screen.getByRole('link')).toHaveTextContent('neste ledige i dag 11:00');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The quoted start passes: the next ask is due, and its answer has started.
    fetchMock.mockImplementation(() => Promise.resolve(answer(Date.now() - 1)));
    await idle(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link')).toHaveTextContent(/^Bestill time$/);
  });

  it('retries a failure after the minute', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    render(<Probe />);
    await idle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await idle(NEXT_FREE_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that arrives after it unmounted', async () => {
    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );
    const { unmount } = render(<Probe />);
    await idle();
    unmount();
    await act(async () => {
      settle(answer(Date.now() + 3_600_000));
      await vi.advanceTimersByTimeAsync(NEXT_FREE_TTL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('with requestIdleCallback', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('waits for idle, and cancels the idle callback on unmount', () => {
      const requestIdleCallback = vi.fn(() => 7);
      const cancelIdleCallback = vi.fn();
      vi.stubGlobal('requestIdleCallback', requestIdleCallback);
      vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

      const { unmount } = render(<Probe />);
      expect(requestIdleCallback).toHaveBeenCalledTimes(1);
      unmount();
      expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    });

    it('runs on idle, and clears a timer where there is no cancelIdleCallback', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(answer(Date.now() + 3_600_000)));
      vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
        callback();
        return 0;
      });
      vi.stubGlobal('cancelIdleCallback', undefined);

      const { unmount } = render(<Probe />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(() => unmount()).not.toThrow();
    });
  });
});

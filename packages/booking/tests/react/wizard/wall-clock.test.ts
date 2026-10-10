/**
 * The time step's «now»: the seed on the first paint, so the server render
 * and hydration agree, then the wall clock, minute by minute.
 */

import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWallClock } from '../../../src/react/wizard/wall-clock';

const SEED = Date.parse('2026-09-08T08:00:00+02:00');

afterEach(() => vi.useRealTimers());

describe('useWallClock', () => {
  it('renders the seed on the server, whatever the clock says', () => {
    function Probe() {
      return createElement('span', null, String(useWallClock(SEED)));
    }
    expect(renderToString(createElement(Probe))).toContain(String(SEED));
  });

  it('follows the wall clock after mount, every minute, and stops on unmount', () => {
    vi.useFakeTimers({ now: SEED + 3_600_000 });
    const { result, unmount } = renderHook(() => useWallClock(SEED));
    expect(result.current).toBe(SEED + 3_600_000);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(SEED + 3_660_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

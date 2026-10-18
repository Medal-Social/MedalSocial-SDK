import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCacheAdapter } from '../../src/next/cache/memory';
import { loadBookingPage } from '../../src/next/loaders';
import { policySeed } from '../../src/next/policy-window';
import { parseRange } from '../../src/next/routes/shared';
import { testRuntime } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

function runtime(days = 90) {
  const getPolicy = vi.fn(async () => ({ max_advance_days: days }));
  const rt = testRuntime(
    { medal: { getPolicy } as never },
    {
      config: { ...PARITY_CONFIG, window: { ...PARITY_CONFIG.window, followPolicy: true } },
      cache: {
        edge: memoryCacheAdapter(),
        data: memoryCacheAdapter(),
        prefix: 'test',
        environment: 'test',
      },
    }
  );
  return { rt, getPolicy };
}

describe('saved customer booking horizon', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['2026-01-01T22:30:00Z', '2026-09-01T22:30:00Z'])(
    'includes the exact cutoff across daylight saving from %s',
    async (instant) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      const { rt } = runtime(90);
      const seed = await policySeed(rt);
      const window = rt.clock.window(Date.now(), seed.RANGE_DAYS);
      const cutoff = Date.now() + 90 * 86_400_000;
      expect(window.toTs).toBeGreaterThan(cutoff);
      expect(rt.clock.daysBetween(Date.now(), cutoff)).toBe(seed.RANGE_DAYS - 1);
    }
  );
  it('includes the 90-day boundary and refreshes a changed setting without reusing the old seed', async () => {
    const { rt, getPolicy } = runtime();
    const first = await policySeed(rt);
    expect(first.RANGE_DAYS).toBe(91);
    const oldKey = first.seedKeyAt('service', Date.now());
    getPolicy.mockResolvedValue({ max_advance_days: 30 });
    const next = await policySeed(rt);
    expect(next.RANGE_DAYS).toBe(31);
    expect(next.seedKeyAt('service', Date.now())).not.toBe(oldKey);
    expect(getPolicy).toHaveBeenCalledTimes(2);
  });

  it('keeps static configurations unchanged', async () => {
    const rt = testRuntime();
    expect(await policySeed(rt)).toBe(rt.seed);
  });

  it('reuses a seed with an unchanged horizon only after reading the setting again', async () => {
    const { rt, getPolicy } = runtime();
    const first = await policySeed(rt);
    expect(await policySeed(rt)).toBe(first);
    expect(getPolicy).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, 401, 1.5, Number.NaN])('refuses an invalid horizon %s', async (days) => {
    await expect(policySeed(runtime(days).rt)).rejects.toThrow('Invalid public booking horizon');
  });

  it('fails closed when the setting cannot be loaded', async () => {
    const { rt, getPolicy } = runtime();
    getPolicy.mockRejectedValue(new Error('unavailable'));
    rt.session.readPortalSession = async () => null;
    expect((await loadBookingPage(rt)).kind).toBe('unavailable');
  });

  it('allows a policy-sized browser request while retaining the static and maximum span guards', () => {
    const request = (days: number) =>
      new URLSearchParams({ from_ts: '1', to_ts: String(1 + days * 86400000) });
    expect(parseRange(request(91))).toHaveProperty('error');
    expect(parseRange(request(91), true)).not.toHaveProperty('error');
    expect(parseRange(request(401), true)).not.toHaveProperty('error');
    expect(parseRange(request(403), true)).toHaveProperty('error');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCacheAdapter } from '../../src/next/cache/memory';
import { loadBookingPage } from '../../src/next/loaders';
import { policySeed } from '../../src/next/policy-window';
import { nextFreeRoute } from '../../src/next/routes/catalogue-routes';
import { forgetBookedSlots, parseRange } from '../../src/next/routes/shared';
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

  it.each([true, false])(
    'expires policy seed keys on both passes, with a warm runtime: %s',
    async (warm) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-03T10:00:00Z'));
      const { rt, getPolicy } = runtime();
      vi.spyOn(rt.catalogue, 'cachedServices').mockResolvedValue([
        {
          id: 'service',
          name: 'Cut',
          category: 'barn',
          bookable_online: true,
          duration_minutes: 30,
          price_ore: 30000,
        },
      ] as never);
      // A different runtime represents another request/isolate sharing the edge cache.
      const pageRuntime = warm
        ? rt
        : testRuntime({ medal: rt.medal, catalogue: rt.catalogue }, rt.options);
      const pageSeed = await policySeed(pageRuntime);
      const key = pageSeed.seedKeyAt('service', Date.now())!;
      const latest = pageSeed.seedLatestKeyAt('service', Date.now())!;
      expect(key).toContain('/91/');
      expect(key).not.toBe(rt.seed.seedKeyAt('service', Date.now()));
      const edge = rt.options.cache.edge;
      await edge.put(key, { stale: true }, 300);
      await edge.put(latest, { stale: true }, 300);
      await forgetBookedSlots(rt, ['service']);
      await vi.advanceTimersByTimeAsync(0);
      expect(await edge.get(key)).toBeUndefined();
      expect(await edge.get(latest)).toBeUndefined();
      // Reproduce a seed rebuilt from a stale slot read after the first delete.
      await edge.put(key, { rebuilt: true }, 300);
      await edge.put(latest, { rebuilt: true }, 300);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await edge.get(key)).toBeUndefined();
      expect(await edge.get(latest)).toBeUndefined();
      expect(getPolicy).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps the completed write successful and marks expiry when the policy read fails', async () => {
    vi.useFakeTimers();
    const { rt, getPolicy } = runtime();
    vi.spyOn(rt.catalogue, 'cachedServices').mockResolvedValue([]);
    getPolicy.mockRejectedValue(new Error('policy unavailable'));
    await expect(forgetBookedSlots(rt, ['service'])).resolves.toBeUndefined();
    expect(await rt.options.cache.edge.get(rt.seed.expiryMarkerKey('service')!)).toBeDefined();
    expect(rt.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not expire the booking caches after a write'
    );
    await vi.advanceTimersByTimeAsync(2000);
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
  it('uses the same policy seed for next-free and fails closed on a later policy error', async () => {
    const { rt, getPolicy } = runtime();
    const source = await policySeed(rt);
    const future = Date.now() + 3600000;
    vi.spyOn(source, 'loadBookingSeed').mockResolvedValue({
      slots: { service: [{ startTs: future, resourceId: 'resource' }] },
    } as never);
    expect(await (await nextFreeRoute(rt)).json()).toMatchObject({ startTs: future });
    getPolicy.mockRejectedValue(new Error('policy unavailable'));
    const response = await nextFreeRoute(rt);
    expect(await response.json()).toEqual({ startTs: null, label: null });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

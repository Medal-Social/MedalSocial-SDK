import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_POLICY_READ_MS } from '../../src/core/range';
import { memoryCacheAdapter } from '../../src/next/cache/memory';
import { createCatalogue } from '../../src/next/catalogue';
import { loadBookingPage } from '../../src/next/loaders';
import { policySeed } from '../../src/next/policy-window';
import { testLogger, testRuntime } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-02T10:07:40+02:00');
const slot = (days: number) => ({
  start_ts: new Date(NOW + days * DAY).toISOString(),
  end_ts: null,
  resource_id: 'r',
});
function setup() {
  const medal = {
    getPolicy: vi.fn().mockResolvedValue({ max_advance_days: 90 }),
    listServices: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    listAvailability: vi.fn().mockResolvedValue([slot(45)]),
    listSchedule: vi.fn().mockResolvedValue([{ date: '2026-10-17' }]),
  };
  const catalogue = createCatalogue(
    {
      config: { ...PARITY_CONFIG, window: { ...PARITY_CONFIG.window, followPolicy: true } },
      cache: { data: memoryCacheAdapter(), prefix: 'policy-cache' },
      logger: testLogger(),
    },
    medal
  );
  return { medal, catalogue };
}
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

describe('live policy before cached booking reads', () => {
  it('shares only an in-flight policy check between concurrent seed reads', async () => {
    const { medal, catalogue } = setup();
    const args = { serviceId: 's', fromTs: NOW, toTs: NOW + DAY };
    await Promise.all([catalogue.cachedAvailability(args), catalogue.cachedSchedule(args)]);
    expect(medal.getPolicy).toHaveBeenCalledTimes(1);
    await catalogue.cachedAvailability(args);
    expect(medal.getPolicy).toHaveBeenCalledTimes(2);
  });
  it.each(['cachedAvailability', 'cachedSchedule'] as const)(
    'retires a cached later chunk after reduction: %s',
    async (read) => {
      const { medal, catalogue } = setup();
      const args = { serviceId: 's', fromTs: NOW + 40 * DAY, toTs: NOW + 50 * DAY };
      expect(await catalogue[read](args)).toHaveLength(1);
      medal.getPolicy.mockResolvedValue({ max_advance_days: 30 });
      expect(await catalogue[read](args)).toEqual([]);
      expect(medal.getPolicy).toHaveBeenCalledTimes(2);
      const upstream = read === 'cachedAvailability' ? medal.listAvailability : medal.listSchedule;
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['cachedAvailability', 'cachedSchedule'] as const)(
    'separates cache identities after a policy change: %s',
    async (read) => {
      const { medal, catalogue } = setup();
      medal.listAvailability.mockResolvedValue([slot(5)]);
      medal.listSchedule.mockResolvedValue([{ date: '2026-09-07' }]);
      const args = { serviceId: 's', fromTs: NOW, toTs: NOW + 10 * DAY };
      await catalogue[read](args);
      await catalogue[read](args);
      const upstream = read === 'cachedAvailability' ? medal.listAvailability : medal.listSchedule;
      expect(upstream).toHaveBeenCalledTimes(1);
      medal.getPolicy.mockResolvedValue({ max_advance_days: 30 });
      await catalogue[read](args);
      expect(upstream).toHaveBeenCalledTimes(2);
      medal.getPolicy.mockRejectedValue(new Error('policy unavailable'));
      await expect(catalogue[read](args)).rejects.toThrow('policy unavailable');
      expect(upstream).toHaveBeenCalledTimes(2);
    }
  );
  it('clamps the partial boundary day even for fresh, stylist-specific reads', async () => {
    const { medal, catalogue } = setup();
    medal.getPolicy.mockResolvedValue({ max_advance_days: 30 });
    medal.listAvailability.mockResolvedValue([slot(29), slot(30), slot(31)]);
    const args = { serviceId: 's', resourceId: 'r', fromTs: NOW + 20 * DAY, toTs: NOW + 40 * DAY };
    expect(await catalogue.cachedAvailability(args, { fresh: true })).toEqual([slot(29), slot(30)]);
    expect(medal.listAvailability).toHaveBeenCalledWith({ ...args, toTs: NOW + 30 * DAY + 1 });
    await catalogue.cachedSchedule(args);
    expect(medal.listSchedule).toHaveBeenCalledWith({ ...args, toTs: NOW + 30 * DAY + 1 });
  });
  it.each(['cachedAvailability', 'cachedSchedule'] as const)(
    'does not expand an anonymous-sized chunk beyond its bound: %s',
    async (read) => {
      const { medal, catalogue } = setup();
      const args = { serviceId: 's', fromTs: NOW, toTs: NOW + MAX_POLICY_READ_MS };
      await catalogue[read](args);
      const upstream = read === 'cachedAvailability' ? medal.listAvailability : medal.listSchedule;
      expect(upstream).toHaveBeenCalledWith(args);
      await expect(catalogue[read]({ ...args, toTs: args.toTs + 1 })).rejects.toThrow(
        'chunk limit'
      );
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  );
  it('does not round a short cached request beyond the current cutoff', async () => {
    const { medal, catalogue } = setup();
    medal.getPolicy.mockResolvedValue({ max_advance_days: 1 });
    const args = { serviceId: 's', fromTs: NOW, toTs: NOW + DAY };
    await catalogue.cachedAvailability(args);
    expect(medal.listAvailability).toHaveBeenCalledWith(args);
  });
});

describe('policy seed integrity', () => {
  it.each(['change', 'outage'] as const)(
    'does not publish or cache a partial seed after a policy %s',
    async (failure) => {
      const { medal } = setup();
      medal.listServices.mockResolvedValue([
        {
          id: 's',
          name: 'Cut',
          category: 'barn',
          bookable_online: true,
          duration_minutes: 30,
          price_ore: 30000,
        },
      ]);
      const edge = memoryCacheAdapter();
      const put = vi.spyOn(edge, 'put');
      const rt = testRuntime(
        { medal: medal as never },
        {
          config: { ...PARITY_CONFIG, window: { ...PARITY_CONFIG.window, followPolicy: true } },
          cache: { edge, data: memoryCacheAdapter(), prefix: 'seed-policy', environment: 'test' },
        }
      );
      rt.session.readPortalSession = async () => null;
      const source = await policySeed(rt);
      medal.getPolicy.mockResolvedValueOnce({ max_advance_days: 90 });
      if (failure === 'change') medal.getPolicy.mockResolvedValue({ max_advance_days: 7 });
      else medal.getPolicy.mockRejectedValue(new Error('offline'));
      expect((await loadBookingPage(rt)).kind).toBe('unavailable');
      const seedKey = source.seedKeyAt('s', NOW);
      expect(put.mock.calls.some(([key]) => key === seedKey)).toBe(false);
      // No poisoned seed remains after retry with the current setting.
      medal.getPolicy.mockResolvedValue({ max_advance_days: 7 });
      expect(await loadBookingPage(rt)).toMatchObject({
        kind: 'ready',
        seed: { maxAdvanceDays: 7 },
      });
    }
  );
  it.each(['cached', 'fresh', 'resource'] as const)(
    'drops slots that start during a %s read',
    async (mode) => {
      const { medal, catalogue } = setup();
      const started = { ...slot(0), start_ts: new Date(NOW + 1000).toISOString() };
      const future = slot(1);
      medal.listAvailability.mockResolvedValue([started, future]);
      const args = {
        serviceId: 's',
        fromTs: NOW,
        toTs: NOW + 2 * DAY,
        ...(mode === 'resource' ? { resourceId: 'r' } : {}),
      };
      // Warm the data cache, then cross the slot start while verifying policy.
      await catalogue.cachedAvailability(args);
      medal.getPolicy.mockImplementation(async () => {
        vi.mocked(Date.now).mockReturnValue(NOW + 2000);
        return { max_advance_days: 90 };
      });
      expect(await catalogue.cachedAvailability(args, { fresh: mode === 'fresh' })).toEqual([
        future,
      ]);
    }
  );
});

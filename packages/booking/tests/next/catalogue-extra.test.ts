import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryCacheAdapter } from '../../src/next/cache/memory';
import { noopCacheAdapter } from '../../src/next/cache/noop';
import { createCatalogue, slotKeyStart, slotsTag } from '../../src/next/catalogue';
import type { BookingCacheAdapter } from '../../src/next/options';
import { testLogger } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

/**
 * The catalogue through the key-value adapters (`memory`, `noop`, a bare
 * `get`/`put` store) — the `cacheLoad` default read-through — and the slot
 * filter and expiry edges the moved suite does not reach.
 */

const NOW = Date.parse('2026-09-02T10:07:40+02:00');
const TO = Date.parse('2026-09-09T00:00:00+02:00');

function seam() {
  return {
    listServices: vi.fn().mockResolvedValue([{ id: 'svc' }]),
    listResources: vi.fn().mockResolvedValue([{ id: 'res' }]),
    listAvailability: vi.fn().mockResolvedValue([]),
    listSchedule: vi.fn().mockResolvedValue([]),
  };
}

function catalogueOver(data: BookingCacheAdapter, medal = seam(), logger = testLogger()) {
  return {
    medal,
    logger,
    catalogue: createCatalogue(
      { config: PARITY_CONFIG, cache: { data, prefix: 'demo-booking' }, logger },
      medal
    ),
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

describe('through the memory adapter', () => {
  it('serves the second read of every loader from the cache', async () => {
    const { catalogue, medal } = catalogueOver(memoryCacheAdapter({ now: () => NOW }));

    for (let i = 0; i < 2; i += 1) {
      await expect(catalogue.cachedServices()).resolves.toEqual([{ id: 'svc' }]);
      await expect(catalogue.cachedResources()).resolves.toEqual([{ id: 'res' }]);
      await catalogue.cachedSchedule({ serviceId: 'svc', fromTs: NOW, toTs: TO });
      await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });
    }

    expect(medal.listServices).toHaveBeenCalledTimes(1);
    expect(medal.listResources).toHaveBeenCalledTimes(1);
    expect(medal.listSchedule).toHaveBeenCalledTimes(1);
    expect(medal.listAvailability).toHaveBeenCalledTimes(1);
  });

  it('reads a service live again once its slot tag is expired', async () => {
    const { catalogue, medal } = catalogueOver(memoryCacheAdapter({ now: () => NOW }));

    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });
    catalogue.expireSlots(['svc']);
    // The memory adapter's expiry is async under the hood; let it land.
    await Promise.resolve();
    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });

    expect(medal.listAvailability).toHaveBeenCalledTimes(2);
  });

  it('caches nothing that failed', async () => {
    const medal = seam();
    medal.listServices.mockRejectedValueOnce(new Error('Medal blip'));
    const { catalogue } = catalogueOver(memoryCacheAdapter({ now: () => NOW }), medal);

    await expect(catalogue.cachedServices()).rejects.toThrow('Medal blip');
    await expect(catalogue.cachedServices()).resolves.toEqual([{ id: 'svc' }]);
    expect(medal.listServices).toHaveBeenCalledTimes(2);
  });
});

describe('through the noop adapter', () => {
  it('reads Medal on every call', async () => {
    const { catalogue, medal } = catalogueOver(noopCacheAdapter());

    await catalogue.cachedServices();
    await catalogue.cachedServices();
    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });
    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });

    expect(medal.listServices).toHaveBeenCalledTimes(2);
    expect(medal.listAvailability).toHaveBeenCalledTimes(2);
  });
});

describe('through a bare key-value store', () => {
  function store() {
    const entries = new Map<string, unknown>();
    const adapter: BookingCacheAdapter = {
      get: vi.fn(async (key: string) => entries.get(key) as never),
      put: vi.fn(async (key: string, value: unknown) => {
        entries.set(key, value);
      }),
      delete: vi.fn(async () => {}),
    };
    return { adapter, entries };
  }

  it('stores under the key parts and arguments, with the TTL and tags', async () => {
    const { adapter, entries } = store();
    const { catalogue } = catalogueOver(adapter);

    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });

    expect(adapter.put).toHaveBeenCalledWith(expect.any(String), [], 30, {
      tags: [slotsTag('svc')],
    });
    const [key] = [...entries.keys()];
    expect(key).toContain('demo-booking');
    expect(key).toContain('availability');
    expect(key).toContain(String(slotKeyStart(NOW, NOW)));
  });

  it('treats a get that throws as a miss and a put that throws as harmless', async () => {
    const adapter: BookingCacheAdapter = {
      get: vi.fn().mockRejectedValue(new Error('store down')),
      put: vi.fn().mockRejectedValue(new Error('store down')),
      delete: vi.fn(),
    };
    const { catalogue, medal } = catalogueOver(adapter);

    await expect(catalogue.cachedServices()).resolves.toEqual([{ id: 'svc' }]);
    expect(medal.listServices).toHaveBeenCalledTimes(1);
  });

  it('does nothing on expiry when the store has no tags', () => {
    const { adapter } = store();
    const { catalogue, logger } = catalogueOver(adapter);

    expect(() => catalogue.expireSlots(['svc'])).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('expireSlots', () => {
  it('logs an expiry that rejects, and still never throws', async () => {
    const failure = new Error('tag store down');
    const adapter: BookingCacheAdapter = {
      ...noopCacheAdapter(),
      expireTag: vi.fn().mockRejectedValue(failure),
    };
    const { catalogue, logger } = catalogueOver(adapter);

    expect(() => catalogue.expireSlots(['svc'])).not.toThrow();
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        { err: failure, serviceId: 'svc' },
        'Could not expire cached booking slots'
      )
    );
  });

  it('logs an expiry that throws synchronously', () => {
    const failure = new Error('no store');
    const adapter: BookingCacheAdapter = {
      ...noopCacheAdapter(),
      expireTag: () => {
        throw failure;
      },
    };
    const { catalogue, logger } = catalogueOver(adapter);

    catalogue.expireSlots(['svc']);

    expect(logger.warn).toHaveBeenCalledWith(
      { err: failure, serviceId: 'svc' },
      'Could not expire cached booking slots'
    );
  });
});

describe('the slot filter', () => {
  it('keeps a slot with no start, and one with an unreadable start, for the DTO to drop', async () => {
    const medal = seam();
    medal.listAvailability.mockResolvedValue([
      { start_ts: null, end_ts: null, resource_id: 'r1' },
      { start_ts: 'not a date', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T08:00:00.000Z', end_ts: null, resource_id: 'r1' },
    ]);
    const { catalogue } = catalogueOver(noopCacheAdapter(), medal);

    const slots = await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: TO });

    expect(slots.map((slot) => slot.start_ts)).toEqual([null, 'not a date']);
  });

  it('reads a range that ends, on a midnight, before it starts live', async () => {
    const { catalogue, medal } = catalogueOver(memoryCacheAdapter({ now: () => NOW }));
    const midnight = Date.parse('2026-09-02T00:00:00+02:00');

    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: midnight });
    await catalogue.cachedAvailability({ serviceId: 'svc', fromTs: NOW, toTs: midnight });

    expect(medal.listAvailability).toHaveBeenCalledTimes(2);
    expect(medal.listAvailability).toHaveBeenCalledWith({
      serviceId: 'svc',
      fromTs: NOW,
      toTs: midnight,
    });
  });
});

describe('slotKeyStart', () => {
  it('defaults now to the clock', () => {
    expect(slotKeyStart(0)).toBe(Math.floor(NOW / 30_000) * 30_000);
  });
});

describe('the schedule filter', () => {
  it('keeps a day with no date, for the DTO to drop', async () => {
    const medal = seam();
    medal.listSchedule.mockResolvedValue([
      { date: null, opens_ts: null, closes_ts: null, last_start_ts: null },
      { date: '2026-09-20', opens_ts: null, closes_ts: null, last_start_ts: null },
    ]);
    const { catalogue } = catalogueOver(noopCacheAdapter(), medal);

    const days = await catalogue.cachedSchedule({ serviceId: 'svc', fromTs: NOW, toTs: TO });

    expect(days.map((day) => day.date)).toEqual([null]);
  });
});

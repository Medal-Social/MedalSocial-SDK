import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDto } from '../../src/core/dto';
import { memoryCacheAdapter } from '../../src/next/cache/memory';
import { workersCacheAdapter } from '../../src/next/cache/workers';
import type { BookingCacheAdapter } from '../../src/next/options';
import { createSeed, type SeedOptions } from '../../src/next/seed';
import { createFakeColoCache, installColoCache } from '../support/colo-cache';
import { testLogger } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

/**
 * The seed over adapters the moved suite does not use — a plain key-value
 * store with no `key` or `version`, one that refuses some keys, one that
 * fails — and the configuration edges: no prefetch category, a deploy
 * version, a custom edge prefix.
 */

function medalService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-a',
    name: 'Klipp A',
    description: null,
    category: 'barn',
    duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    price_ore: 49_000,
    bookable_online: true,
    max_per_booking: 3,
    weekend_surcharge_pct: 10,
    ...overrides,
  };
}

const MENU = [
  medalService(),
  medalService({ id: 'svc-b', name: 'Klipp B' }),
  medalService({ id: 'svc-c', name: 'Farge', category: 'farge' }),
];

const NOW = Date.parse('2026-09-02T08:00:07.030+02:00');
const SLOT = Date.parse('2026-09-02T10:00:00+02:00');

const { toBookingServiceDto } = createDto(PARITY_CONFIG);

function catalogue() {
  return {
    cachedServices: vi.fn().mockResolvedValue(MENU),
    cachedResources: vi
      .fn()
      .mockResolvedValue([
        { id: 'res-1', name: 'R', photo_url: null, bio: null, service_ids: [], sort_order: 1 },
      ]),
    cachedAvailability: vi
      .fn()
      .mockResolvedValue([{ start_ts: new Date(SLOT).toISOString(), resource_id: 'res-1' }]),
    cachedSchedule: vi.fn().mockResolvedValue([]),
  };
}

interface Rules {
  /** Keys containing any of these the adapter cannot store. */
  refuse?: string[];
  /** Reads of keys containing this throw. */
  getThrows?: string;
  /** Writes of keys containing this reject. */
  putRejects?: string;
  /** Writes of keys containing this throw before returning a promise. */
  putThrowsSync?: string;
}

/** A memory store, plus whatever `rules` say it refuses or fails at. */
function store(rules: Rules = {}) {
  const memory = memoryCacheAdapter({ now: () => NOW });
  const adapter: BookingCacheAdapter = {
    get<T>(key: string) {
      if (rules.getThrows && key.includes(rules.getThrows)) {
        return Promise.reject(new Error('read failed'));
      }
      return memory.get<T>(key);
    },
    put: vi.fn((key: string, value: unknown, ttl: number) => {
      if (rules.putThrowsSync && key.includes(rules.putThrowsSync)) throw new Error('sync put');
      if (rules.putRejects && key.includes(rules.putRejects)) {
        return Promise.reject(new Error('write failed'));
      }
      return memory.put(key, value, ttl);
    }),
    delete: vi.fn((keys: readonly string[]) => memory.delete(keys)),
  };
  if (rules.refuse) {
    const refused = rules.refuse;
    adapter.key = (key) => (refused.some((part) => key.includes(part)) ? null : key);
  }
  return { adapter, memory };
}

function seedOver(
  edge: BookingCacheAdapter,
  overrides: Partial<SeedOptions> = {},
  reads = catalogue()
) {
  const logger = testLogger();
  const timing = vi.fn();
  const seed = createSeed(
    {
      config: PARITY_CONFIG,
      cache: { edge, environment: '' },
      logger,
      timing,
      ...overrides,
    },
    reads
  );
  return { seed, reads, logger, timing };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

describe('a key-value store with no key mapping or version', () => {
  it('keys on the package path itself, environment defaulting to unknown', () => {
    const { seed } = seedOver(store().adapter);
    expect(seed.seedKeyAt('svc-a', NOW)).toBe(
      `/__medal-edge/booking-seed/v1/unknown/seed/2026-09-02/svc-a/${Math.floor(NOW / 30_000)}`
    );
    expect(seed.catalogueLatestKey()).toBe(
      '/__medal-edge/booking-seed/v1/unknown/catalogue/latest'
    );
    expect(seed.expiryMarkerKey('svc a')).toBe('/__medal-edge/booking-seed/v1/unknown/gen/svc%20a');
  });

  it('takes a custom edge prefix and an environment', () => {
    const { seed } = seedOver(store().adapter, {
      cache: { edge: store().adapter, environment: 'staging', edgePrefix: '/edge/v2' },
    });
    expect(seed.catalogueKeyAt(NOW)).toBe(`/edge/v2/staging/catalogue/${Math.floor(NOW / 60_000)}`);
  });

  it('misses, stores, and then hits', async () => {
    const { seed, reads, timing } = seedOver(store().adapter);

    const miss = await seed.loadBookingSeed(undefined);
    expect(timing).toHaveBeenCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
    const hit = await seed.loadBookingSeed(undefined);
    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'hit' })
    );

    expect(reads.cachedServices).toHaveBeenCalledTimes(1);
    expect(hit.slots).toEqual(miss.slots);
    expect(hit.nextAvailable).toEqual({ 'svc-a': { 'res-1': SLOT }, 'svc-b': { 'res-1': SLOT } });
  });

  it('reads the clock when no instant is passed', async () => {
    const { seed } = seedOver(store().adapter);
    const loaded = await seed.loadBookingCatalogue();
    expect(loaded.services.map((service) => service.id)).toEqual(['svc-a', 'svc-b', 'svc-c']);
  });

  it('works with no timing sink at all', async () => {
    const { seed } = seedOver(store().adapter, { timing: undefined });
    await expect(seed.loadBookingSeed(undefined, NOW)).resolves.toMatchObject({ fromTs: NOW });
  });
});

describe('the deploy version', () => {
  it('is mixed into every key, after the environment', () => {
    const fake = createFakeColoCache();
    const edge = workersCacheAdapter({
      origin: 'https://salong.example',
      version: 'v9',
      cache: () => fake.cache,
    });
    const { seed } = seedOver(edge, { cache: { edge, environment: 'production' } });
    expect(seed.catalogueLatestKey()).toBe(
      'https://salong.example/__medal-edge/booking-seed/v1/production-v9/catalogue/latest'
    );
  });

  it('comes from the Worker version binding by default', () => {
    const fake = createFakeColoCache();
    const uninstall = installColoCache(fake);
    try {
      const edge = workersCacheAdapter({
        origin: 'https://salong.example',
        context: () => ({ env: { CF_VERSION_METADATA: { id: 'abc' } } }),
      });
      const { seed } = seedOver(edge);
      expect(seed.catalogueLatestKey()).toBe(
        'https://salong.example/__medal-edge/booking-seed/v1/unknown-abc/catalogue/latest'
      );
    } finally {
      uninstall();
    }
  });
});

describe('a config with no prefetch category', () => {
  const config = {
    ...PARITY_CONFIG,
    window: { ...PARITY_CONFIG.window, prefetchCategory: null },
  };
  const services = MENU.map((service) => toBookingServiceDto(service as never));

  it('prefetches only what a link names', () => {
    const { seed } = seedOver(store().adapter, { config });
    expect(seed.prefetchTargets(services, undefined)).toEqual([]);
    expect(seed.prefetchTargets(services, 'svc-c').map((s) => s.id)).toEqual(['svc-c']);
    expect(seed.allPrefetchKeys(services)).toEqual(['svc-a', 'svc-b', 'svc-c']);
  });

  it('keys no seed for an empty set, and builds it live', async () => {
    const { seed, reads, timing } = seedOver(store().adapter, { config });
    expect(seed.seedKeyAt('', NOW)).toBeNull();
    expect(seed.seedLatestKeyAt('', NOW)).toBeNull();

    const loaded = await seed.loadBookingSeed(undefined, NOW);

    expect(loaded.slots).toEqual({});
    expect(reads.cachedAvailability).not.toHaveBeenCalled();
    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'bypass' })
    );
  });
});

describe('seedKeysFor and expireBookingSeeds with nothing to expire', () => {
  it('answers no keys and does nothing', async () => {
    const { adapter } = store();
    const { seed } = seedOver(adapter);
    const services = MENU.map((service) => toBookingServiceDto(service as never));
    expect(seed.seedKeysFor(services, [], NOW)).toEqual([]);
    await seed.expireBookingSeeds([], NOW, 0);
    expect(adapter.put).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });
});

describe('an adapter that refuses some keys', () => {
  it('without expiry markers: stores a seed even after an expire, and marks nothing', async () => {
    const { adapter } = store({ refuse: ['/gen'] });
    const { seed } = seedOver(adapter);
    expect(seed.expiryMarkerKey('svc-a')).toBeNull();
    expect(seed.anyExpiryMarkerKey()).toBeNull();

    await seed.expireBookingSeeds(['svc-a'], NOW, 0);
    expect(adapter.put).not.toHaveBeenCalled();

    await seed.loadBookingSeed(undefined, NOW);
    const key = seed.seedKeyAt('svc-a,svc-b', NOW) ?? '';
    await expect(adapter.get(key)).resolves.toBeDefined();
  });

  it('without a kept catalogue: stores the bucket only, and never serves one stale', async () => {
    const { adapter } = store({ refuse: ['/catalogue/latest'] });
    const { seed, reads } = seedOver(adapter);
    expect(seed.catalogueLatestKey()).toBeNull();

    await seed.loadBookingCatalogue(NOW);
    await seed.loadBookingCatalogue(NOW + 2 * 60_000);

    expect(reads.cachedServices).toHaveBeenCalledTimes(2);
    expect(adapter.put).toHaveBeenCalledTimes(2);
  });

  it('without a kept seed: misses after the bucket turns rather than serving stale', async () => {
    const { adapter } = store({ refuse: ['/seed-latest/'] });
    const { seed, reads, timing } = seedOver(adapter);
    expect(seed.seedLatestKeyAt('svc-a', NOW)).toBeNull();

    await seed.loadBookingSeed(undefined, NOW);
    await seed.loadBookingSeed(undefined, NOW + 60_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
    expect(reads.cachedAvailability).toHaveBeenCalledTimes(4);
  });

  it('without catalogue keys: marks the services but deletes nothing', async () => {
    const { adapter } = store({ refuse: ['/catalogue/'] });
    const { seed, reads } = seedOver(adapter);
    expect(seed.catalogueKeyAt(NOW)).toBeNull();

    await seed.expireBookingSeeds(['svc-a'], NOW, 0);
    // The service's marker and the location-wide one.
    await vi.waitFor(() => expect(adapter.put).toHaveBeenCalledTimes(2));
    // Let the background passes run.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(adapter.delete).not.toHaveBeenCalled();
    expect(reads.cachedServices).not.toHaveBeenCalled();
  });
});

describe('an adapter that fails', () => {
  it('counts an unreadable expiry marker as no write, and stores the seed', async () => {
    const { adapter } = store({ getThrows: '/gen/' });
    const { seed } = seedOver(adapter);

    await seed.loadBookingSeed(undefined, NOW);

    const key = seed.seedKeyAt('svc-a,svc-b', NOW) ?? '';
    await expect(adapter.get(key)).resolves.toBeDefined();
  });

  it('logs an expiry marker it could not write, and still resolves', async () => {
    const { adapter } = store({ putRejects: '/gen/' });
    const { seed, logger } = seedOver(adapter);

    await expect(seed.expireBookingSeeds(['svc-a'], NOW, 0)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not mark booking seeds expired'
    );
  });

  it('logs a catalogue refresh that fails behind a stale serve', async () => {
    const { adapter } = store();
    const { seed, reads, logger } = seedOver(adapter);
    await seed.loadBookingCatalogue(NOW);

    reads.cachedServices.mockRejectedValue(new Error('Medal down'));
    const stale = await seed.loadBookingCatalogue(NOW + 2 * 60_000);

    expect(stale.services.map((service) => service.id)).toEqual(['svc-a', 'svc-b', 'svc-c']);
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Could not refresh the booking catalogue'
      )
    );
  });

  it('logs a seed refresh that fails behind a stale serve', async () => {
    const rules: Rules = {};
    const { adapter } = store(rules);
    const { seed, logger, timing } = seedOver(adapter);
    await seed.loadBookingSeed(undefined, NOW);

    // The next bucket's write throws before it is even a promise.
    rules.putThrowsSync = '/seed/';
    await seed.loadBookingSeed(undefined, NOW + 60_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'stale' })
    );
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Could not refresh the booking seed'
      )
    );
  });

  it('keeps a newer kept catalogue over an older rebuild', async () => {
    const { adapter, memory } = store();
    const { seed } = seedOver(adapter);
    const latest = seed.catalogueLatestKey() ?? '';
    const newer = { services: [], resources: [], builtAt: NOW + 1_000_000 };
    await memory.put(latest, newer, 3_600);

    await seed.loadBookingCatalogue(NOW);

    await expect(memory.get(latest)).resolves.toEqual(newer);
    await expect(memory.get(seed.catalogueKeyAt(NOW) ?? '')).resolves.toBeDefined();
  });
});

/**
 * Pre-release review: a bucketed hit honours the expiry markers (#176), but
 * read one marker per prefetched service — up to 21 edge reads per hit at the
 * maximum prefetch set. It now reads the seed and ONE location-wide marker,
 * and the per-service ones only when that marker says a write landed around
 * or after the seed was built.
 */
describe('expiry markers on a hit', () => {
  const MAX = 20;
  const BIG_MENU = Array.from({ length: MAX + 2 }, (_, index) =>
    medalService({ id: `svc-${String(index).padStart(2, '0')}`, name: `Klipp ${index}` })
  );
  const BIG_CONFIG = {
    ...PARITY_CONFIG,
    window: { ...PARITY_CONFIG.window, prefetchLimit: MAX },
  };

  /** Lets the background delete passes of `expireBookingSeeds` finish. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  /** A seed over the maximum prefetch set, with every edge read counted. */
  function bigSeed() {
    const { adapter, memory } = store();
    const get = vi.spyOn(adapter, 'get');
    const reads = catalogue();
    reads.cachedServices.mockResolvedValue(BIG_MENU);
    const { seed, timing } = seedOver(adapter, { config: BIG_CONFIG }, reads);
    const markerReads = () =>
      get.mock.calls.filter(([key]) => key.includes('/gen')).map(([key]) => key);
    return { adapter, memory, get, seed, reads, timing, markerReads };
  }

  async function warm(seed: ReturnType<typeof bigSeed>['seed'], at = NOW) {
    await seed.loadBookingSeed(undefined, at);
    const services = BIG_MENU.map((service) => toBookingServiceDto(service as never));
    expect(seed.prefetchTargets(services, undefined)).toHaveLength(MAX);
  }

  it('reads the seed and one marker on a hit with the maximum prefetch set', async () => {
    const { seed, get, timing, markerReads } = bigSeed();
    await warm(seed);

    get.mockClear();
    await seed.loadBookingSeed(undefined, NOW + 2_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'hit' })
    );
    expect(markerReads()).toEqual([seed.anyExpiryMarkerKey()]);
    // The bucketed catalogue, the bucketed seed and the one marker.
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('still reads one marker on a hit when the last write here is well before the seed', async () => {
    const { seed, get, markerReads } = bigSeed();
    await seed.expireBookingSeeds(['svc-00'], NOW - 60_000, 0);
    await warm(seed);

    get.mockClear();
    await seed.loadBookingSeed(undefined, NOW + 2_000);

    expect(markerReads()).toEqual([seed.anyExpiryMarkerKey()]);
  });

  it('serves a hit after a write to a service outside its prefetch set', async () => {
    const { seed, reads, timing, markerReads, get } = bigSeed();
    await warm(seed);
    // svc-21 is bookable but past the prefetch limit.
    await seed.expireBookingSeeds(['svc-21'], NOW + 1_000, 0);
    await settle();

    reads.cachedAvailability.mockClear();
    get.mockClear();
    await seed.loadBookingSeed(undefined, NOW + 2_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'hit' })
    );
    expect(reads.cachedAvailability).not.toHaveBeenCalled();
    // The location-wide marker, then each prefetched service's to rule it out.
    expect(markerReads()).toHaveLength(MAX + 1);
  });

  it('refuses a hit after a write to one of its services', async () => {
    const { seed, memory, timing } = bigSeed();
    await warm(seed);
    const key = seed.seedKeyAt(seed.prefetchKey(BIG_MENU.slice(0, MAX)), NOW) ?? '';
    const built = await memory.get(key);
    expect(built).toBeDefined();
    await seed.expireBookingSeeds(['svc-07'], NOW + 1_000, 0);
    await settle();
    // Put back as if the background delete had not reached this location yet.
    await memory.put(key, built, 30);

    await seed.loadBookingSeed(undefined, NOW + 2_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
  });

  it('refuses a hit when racing writes left the location-wide marker on the earlier one', async () => {
    const { seed, memory, timing } = bigSeed();
    await warm(seed);
    const key = seed.seedKeyAt(seed.prefetchKey(BIG_MENU.slice(0, MAX)), NOW) ?? '';
    const built = await memory.get(key);
    // svc-03 written at NOW + 1 s; another service written at NOW - 20 s
    // whose put of the location-wide marker was slow and landed last.
    await seed.expireBookingSeeds(['svc-03'], NOW + 1_000, 0);
    await settle();
    await memory.put(seed.anyExpiryMarkerKey() ?? '', NOW - 20_000, 600);
    await memory.put(key, built, 30);

    await seed.loadBookingSeed(undefined, NOW + 2_000);

    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
  });

  /** A seed with a marker on `svc-a`, and the location-wide one set too. */
  async function writtenAfterBuild(rules: Rules) {
    const { adapter, memory } = store(rules);
    const { seed, timing } = seedOver(adapter);
    await seed.loadBookingSeed(undefined, NOW);
    const any = seed.anyExpiryMarkerKey();
    if (any !== null) await memory.put(any, NOW + 1_000, 600);
    await memory.put(seed.expiryMarkerKey('svc-a') ?? '', NOW + 1_000, 600);
    await seed.loadBookingSeed(undefined, NOW + 2_000);
    return { seed, timing };
  }

  it('reads the per-service markers when the location-wide one cannot be read', async () => {
    const { timing } = await writtenAfterBuild({ getThrows: '/gen-any' });
    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
  });

  it('reads the per-service markers when the adapter cannot store the location-wide one', async () => {
    const { seed, timing } = await writtenAfterBuild({ refuse: ['/gen-any'] });
    expect(seed.anyExpiryMarkerKey()).toBeNull();
    expect(timing).toHaveBeenLastCalledWith(
      'seed',
      expect.any(Number),
      expect.objectContaining({ state: 'miss' })
    );
  });
});

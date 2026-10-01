import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDto } from '../../src/core/dto';
import { type WorkerContext, workersCacheAdapter } from '../../src/next/cache/workers';
import { createSeed, SEED_STALE_MAX_MS } from '../../src/next/seed';
import { createFakeColoCache, type FakeColoCache, installColoCache } from '../support/colo-cache';
import { testLogger } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

/**
 * The booking seed: one colo Cache API read for everything steps 1–2 of
 * `/bestill` need, built from the catalogue on a miss and dropped on this
 * site's own writes. The Cache API is a map here (`tests/support/colo-cache`),
 * the Worker ctx a plain object handed to the Workers adapter as its context.
 */

const worker = {
  context: undefined as
    | undefined
    | {
        ctx: Record<string | symbol, unknown> & { waitUntil: ReturnType<typeof vi.fn> };
        env: Record<string, unknown>;
      },
};

/** Where the site kept its per-request timings; the timing sink writes it here. */
const REQUEST_STORE_KEY = Symbol('request-store');
interface RequestStore {
  phases: Record<string, number>;
  seed?: string;
}

/** The catalogue the seed builds from, as fakes the tests drive. */
const cachedServices = vi.fn();
const cachedResources = vi.fn();
const cachedAvailability = vi.fn();
const cachedSchedule = vi.fn();

const { toBookingServiceDto } = createDto(PARITY_CONFIG);

const {
  allPrefetchKeys,
  expireBookingSeeds,
  expiryMarkerKey,
  loadBookingSeed,
  PREFETCH_LIMIT,
  prefetchKey,
  prefetchTargets,
  resetSeedRefreshes,
  seedKeyAt,
  seedKeysFor,
  seedLatestKeyAt,
} = createSeed(
  {
    config: PARITY_CONFIG,
    cache: {
      edge: workersCacheAdapter({
        // The site's origin and environment came from these two variables; read
        // per call, so `vi.stubEnv` drives the keys as it drove the module.
        origin: () => process.env.NEXT_PUBLIC_BASE_URL ?? 'https://test.example.com',
        context: () => {
          if (!worker.context) throw new Error('not on Workers');
          return worker.context as WorkerContext;
        },
      }),
      get environment() {
        return process.env.NEXT_PUBLIC_APP_ENV ?? '';
      },
    },
    logger: testLogger(),
    timing: (phase, ms, meta) => {
      // Off Workers there was no request store to write to.
      if (!worker.context) return;
      store.phases[phase] = ms;
      if (meta?.state) store.seed = meta.state;
    },
  },
  { cachedServices, cachedResources, cachedAvailability, cachedSchedule }
);

function medalService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-gutt',
    name: 'Gutteklipp',
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
  medalService({ id: 'svc-jente', name: 'Jenteklipp' }),
  medalService({ id: 'svc-farge', name: 'Farge dame', category: 'farge' }),
  medalService({ id: 'svc-dame', name: 'Dameklipp', category: 'voksen' }),
  medalService({ id: 'svc-intern', name: 'Intern', category: 'barn', bookable_online: false }),
];

const STYLIST = {
  id: 'res-anna',
  name: 'Anna',
  photo_url: null,
  bio: null,
  service_ids: ['svc-gutt'],
  sort_order: 1,
};

/** Wednesday 2 September 2026, 08:00:07.030 Oslo — off the 30 s grid. */
const NOW = Date.parse('2026-09-02T08:00:07.030+02:00');
const SLOT_A = Date.parse('2026-09-02T08:00:20+02:00');
const SLOT_B = Date.parse('2026-09-02T10:00:00+02:00');

let colo: FakeColoCache;
let uninstall: () => void;
let store: RequestStore;

function onWorkers() {
  store = { phases: {} };
  worker.context = {
    ctx: { waitUntil: vi.fn(), [REQUEST_STORE_KEY]: store },
    env: {},
  };
}

/** The work the code handed to `waitUntil`, so the test can wait for it. */
async function drainWaitUntil() {
  const calls = worker.context?.ctx.waitUntil.mock.calls ?? [];
  await Promise.all(calls.map(([promise]) => promise));
}

beforeEach(() => {
  resetSeedRefreshes();
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.mocked(cachedServices)
    .mockReset()
    .mockResolvedValue(MENU as never);
  vi.mocked(cachedResources)
    .mockReset()
    .mockResolvedValue([STYLIST] as never);
  vi.mocked(cachedAvailability)
    .mockReset()
    .mockImplementation(async ({ serviceId }) =>
      serviceId === 'svc-gutt'
        ? ([
            { start_ts: new Date(SLOT_A).toISOString(), resource_id: 'res-anna' },
            { start_ts: new Date(SLOT_B).toISOString(), resource_id: 'res-anna' },
          ] as never)
        : []
    );
  vi.mocked(cachedSchedule).mockReset().mockResolvedValue([]);
  colo = createFakeColoCache();
  uninstall = () => {};
  worker.context = undefined;
});

afterEach(() => {
  uninstall();
  vi.mocked(Date.now).mockRestore();
});

describe('prefetch sets and keys', () => {
  const services = MENU.map((service) => toBookingServiceDto(service as never));

  // The source formed keys from the origin alone; the Workers adapter also
  // answers `null` where there is no Cache API, so these pure key checks run
  // with one installed.
  beforeEach(() => {
    uninstall = installColoCache(colo);
  });

  it('prefetches the bookable kids menu, the linked service first, capped', () => {
    expect(prefetchTargets(services, undefined).map((s) => s.id)).toEqual([
      'svc-gutt',
      'svc-jente',
    ]);
    expect(prefetchTargets(services, 'svc-farge').map((s) => s.id)).toEqual([
      'svc-farge',
      'svc-gutt',
      'svc-jente',
    ]);
    // An unknown or non-bookable value is the default set.
    expect(prefetchTargets(services, 'nope').map((s) => s.id)).toEqual(['svc-gutt', 'svc-jente']);
    expect(prefetchTargets(services, 'svc-intern').map((s) => s.id)).toEqual([
      'svc-gutt',
      'svc-jente',
    ]);
    const many = Array.from({ length: 9 }, (_, i) =>
      toBookingServiceDto(medalService({ id: `svc-${i}` }) as never)
    );
    expect(prefetchTargets(many, undefined)).toHaveLength(PREFETCH_LIMIT);
  });

  it('keys a set by its sorted ids, so order is not a key', () => {
    expect(prefetchKey([{ id: 'svc-jente' }, { id: 'svc-gutt' }])).toBe('svc-gutt,svc-jente');
    expect(prefetchKey([{ id: 'svc-gutt' }, { id: 'svc-jente' }])).toBe('svc-gutt,svc-jente');
  });

  it('composes origin, environment, salon day, ids and a 30 s bucket', () => {
    const key = seedKeyAt('svc-gutt,svc-jente', NOW);
    expect(key).toBe(
      `https://test.example.com/__medal-edge/booking-seed/v1/unknown/seed/2026-09-02/svc-gutt,svc-jente/${Math.floor(NOW / 30_000)}`
    );
    // Same bucket, same key; the next bucket, a new one.
    const bucketStart = Math.floor(NOW / 30_000) * 30_000;
    expect(seedKeyAt('svc-gutt,svc-jente', bucketStart + 29_999)).toBe(key);
    expect(seedKeyAt('svc-gutt,svc-jente', bucketStart + 30_000)).not.toBe(key);
    // Different sets never share a key.
    expect(seedKeyAt('svc-farge,svc-gutt,svc-jente', NOW)).not.toBe(key);
  });

  it('keeps staging and production apart, since they share the zone', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    const staging = seedKeyAt('svc-gutt', NOW);
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    const production = seedKeyAt('svc-gutt', NOW);
    vi.unstubAllEnvs();
    expect(staging).toContain('/v1/staging/');
    expect(production).toContain('/v1/production/');
  });

  it('has at most one key per bookable service plus the default set', () => {
    const keys = allPrefetchKeys(services);
    const bookable = services.filter((s) => s.bookableOnline).length;
    expect(keys.length).toBeLessThanOrEqual(bookable + 1);
    expect(keys).toContain('svc-gutt,svc-jente');
    expect(keys).toContain('svc-farge,svc-gutt,svc-jente');
  });

  it('deletes, for a write, every set holding the service in this and the previous bucket', () => {
    const keys = seedKeysFor(services, ['svc-farge'], NOW);
    // Only the set a «farge» deep link builds holds svc-farge.
    expect(keys).toEqual([
      seedKeyAt('svc-farge,svc-gutt,svc-jente', NOW),
      seedKeyAt('svc-farge,svc-gutt,svc-jente', NOW - 30_000),
      seedLatestKeyAt('svc-farge,svc-gutt,svc-jente', NOW),
    ]);
    // A kids service is in every set.
    const kids = seedKeysFor(services, ['svc-gutt'], NOW);
    expect(kids).toContain(seedKeyAt('svc-gutt,svc-jente', NOW));
    expect(kids).toContain(seedKeyAt('svc-gutt,svc-jente', NOW - 30_000));
    expect(kids).toContain(seedKeyAt('svc-dame,svc-gutt,svc-jente', NOW));
  });
});

describe('loadBookingSeed', () => {
  it('falls back to catalogue-cache on every call when there is no colo cache', async () => {
    const first = await loadBookingSeed(undefined);
    await loadBookingSeed(undefined);

    expect(cachedServices).toHaveBeenCalledTimes(2);
    expect(first.slots['svc-gutt']).toEqual([
      { startTs: SLOT_A, resourceId: 'res-anna' },
      { startTs: SLOT_B, resourceId: 'res-anna' },
    ]);
    expect(first.nextAvailable).toEqual({ 'svc-gutt': { 'res-anna': SLOT_A }, 'svc-jente': {} });
    expect(first.fromTs).toBe(NOW);
  });

  it('marks bypass on Workers without a Cache API', async () => {
    onWorkers();
    await loadBookingSeed(undefined);
    expect(store.seed).toBe('bypass');
    expect(store.phases.catalogue).toEqual(expect.any(Number));
    expect(store.phases.seed).toEqual(expect.any(Number));
  });

  it('misses once, then serves the next visitor from the colo', async () => {
    onWorkers();
    uninstall = installColoCache(colo);

    const miss = await loadBookingSeed(undefined);
    expect(store.seed).toBe('miss');
    await drainWaitUntil();
    // The bucketed catalogue and seed, plus a «latest» copy of each (SP11 P6).
    expect(colo.entries.size).toBe(4);
    const seedEntry = colo.entries.get(seedKeyAt('svc-gutt,svc-jente', NOW) ?? '');
    expect(seedEntry?.cacheControl).toBe('public, max-age=30');

    vi.mocked(cachedServices).mockClear();
    vi.mocked(cachedAvailability).mockClear();
    onWorkers();
    const hit = await loadBookingSeed(undefined);

    expect(store.seed).toBe('hit');
    expect(cachedServices).not.toHaveBeenCalled();
    expect(cachedAvailability).not.toHaveBeenCalled();
    expect(hit.slots).toEqual(miss.slots);
    expect(hit.services).toEqual(miss.services);
    expect(hit.resources).toEqual(miss.resources);
  });

  it('serves a quiet colo its kept seed at once and rebuilds it behind the response', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();

    // A quiet spell: the 30 s bucket and the 60 s catalogue bucket have turned.
    const later = NOW + 2 * 60_000;
    vi.mocked(cachedAvailability).mockClear();
    onWorkers();
    const seed = await loadBookingSeed(undefined, later);

    expect(store.seed).toBe('stale');
    expect(seed.slots['svc-gutt']?.length).toBeGreaterThan(0);
    // The rebuild ran behind the response and refilled this bucket.
    await drainWaitUntil();
    expect(cachedAvailability).toHaveBeenCalled();
    expect(colo.entries.has(seedKeyAt('svc-gutt,svc-jente', later) ?? '')).toBe(true);
  });

  it('never serves a kept seed that a booking on this site has touched since', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();
    const latestKey = seedLatestKeyAt('svc-gutt,svc-jente', NOW) ?? '';
    const kept = colo.entries.get(latestKey);
    expect(kept).toBeDefined();
    // A booking lands on Gutteklipp; its marker and deletes go out.
    expireBookingSeeds(['svc-gutt'], NOW + 1_000, 0);
    await drainWaitUntil();
    expect(colo.entries.has(latestKey)).toBe(false);
    // Put the kept copy back as if a delete had missed it: the marker alone
    // must still refuse it.
    colo.entries.set(latestKey, kept as NonNullable<typeof kept>);

    onWorkers();
    await loadBookingSeed(undefined, NOW + 90_000);
    expect(store.seed).toBe('miss');
  });

  it('shares one rebuild between visitors who arrive while it runs', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();

    const later = NOW + 2 * 60_000;
    vi.mocked(cachedAvailability).mockClear();
    onWorkers();
    await Promise.all([
      loadBookingSeed(undefined, later),
      loadBookingSeed(undefined, later),
      loadBookingSeed(undefined, later),
    ]);
    await drainWaitUntil();
    // One rebuild: one availability read per prefetched service, not three.
    expect(cachedAvailability).toHaveBeenCalledTimes(2);
  });

  it('never lets a rebuild that started earlier replace a newer kept seed', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    const latestKey = seedLatestKeyAt('svc-gutt,svc-jente', NOW) ?? '';
    // A newer copy is already kept (built a minute after this request's instant).
    const newer = { slots: { 'svc-gutt': [] }, schedules: {}, generatedAt: NOW + 60_000 };
    colo.entries.set(latestKey, {
      body: JSON.stringify(newer),
      cacheControl: 'public, max-age=300',
    });

    onWorkers();
    await loadBookingSeed(undefined, NOW);
    await drainWaitUntil();
    expect(JSON.parse(colo.entries.get(latestKey)?.body ?? '{}').generatedAt).toBe(NOW + 60_000);
  });

  it('has the expiry marker in place when a write route stops awaiting it', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await expireBookingSeeds(['svc-gutt'], NOW, 0);
    expect(colo.entries.get(expiryMarkerKey('svc-gutt') ?? '')?.body).toBe(String(NOW));
    await drainWaitUntil();
  });

  it('stops serving a kept seed once it is older than the stale limit', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();

    onWorkers();
    await loadBookingSeed(undefined, NOW + SEED_STALE_MAX_MS + 1_000);
    expect(store.seed).toBe('miss');
  });

  it('drops slots that started since the seed was built, and re-derives «Neste ledige»', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();

    // 20 s later — same 30 s bucket — SLOT_A (08:00:20) has started.
    vi.mocked(Date.now).mockReturnValue(NOW + 20_000);
    onWorkers();
    const hit = await loadBookingSeed(undefined);

    expect(store.seed).toBe('hit');
    expect(hit.slots['svc-gutt']).toEqual([{ startTs: SLOT_B, resourceId: 'res-anna' }]);
    expect(hit.nextAvailable['svc-gutt']).toEqual({ 'res-anna': SLOT_B });
  });

  it('keys a deep-linked set of its own', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed('svc-farge');
    await drainWaitUntil();
    expect(colo.entries.has(seedKeyAt('svc-farge,svc-gutt,svc-jente', NOW) ?? '')).toBe(true);
    expect(colo.entries.has(seedKeyAt('svc-gutt,svc-jente', NOW) ?? '')).toBe(false);
  });

  it('does not store a seed one of whose reads failed', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    vi.mocked(cachedSchedule).mockImplementation(async ({ serviceId }) => {
      if (serviceId === 'svc-jente') throw new Error('Medal blip');
      return [];
    });

    const seed = await loadBookingSeed(undefined);
    await drainWaitUntil();

    expect(seed.schedules).toEqual({ 'svc-gutt': [] });
    expect(colo.entries.has(seedKeyAt('svc-gutt,svc-jente', NOW) ?? '')).toBe(false);
  });

  it('does not store a catalogue without its stylists', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    vi.mocked(cachedResources).mockRejectedValue(new Error('Medal blip'));

    const seed = await loadBookingSeed(undefined);
    await drainWaitUntil();

    expect(seed.resources).toBeNull();
    expect(seed.nextAvailable).toEqual({});
    expect([...colo.entries.keys()].some((key) => key.includes('/catalogue/'))).toBe(false);
  });

  it('throws when the services cannot be read', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    vi.mocked(cachedServices).mockRejectedValue(new Error('Medal down'));
    await expect(loadBookingSeed(undefined)).rejects.toThrow('Medal down');
    expect(colo.entries.size).toBe(0);
  });
});

describe('expireBookingSeeds', () => {
  it('is a no-op off Workers', () => {
    expireBookingSeeds(['svc-gutt']);
    expect(colo.delete).not.toHaveBeenCalled();
  });

  it('deletes the seeds holding the service, current and previous bucket', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await loadBookingSeed('svc-dame');
    await drainWaitUntil();
    const defaultKey = seedKeyAt('svc-gutt,svc-jente', NOW) ?? '';
    const dameKey = seedKeyAt('svc-dame,svc-gutt,svc-jente', NOW) ?? '';
    expect(colo.entries.has(defaultKey)).toBe(true);

    worker.context?.ctx.waitUntil.mockClear();
    expireBookingSeeds(['svc-dame'], NOW, 0);
    await drainWaitUntil();

    // Only the set holding svc-dame went.
    expect(colo.entries.has(dameKey)).toBe(false);
    expect(colo.entries.has(defaultKey)).toBe(true);
    expect(colo.delete).toHaveBeenCalledWith(
      seedKeyAt('svc-dame,svc-gutt,svc-jente', NOW - 30_000)
    );

    expireBookingSeeds(['svc-gutt'], NOW, 0);
    await drainWaitUntil();
    expect(colo.entries.has(defaultKey)).toBe(false);
    // The catalogue stays: a booking does not change the menu.
    expect([...colo.entries.keys()].some((key) => key.includes('/catalogue/'))).toBe(true);
  });

  it('never throws, even when the cache does', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    colo.match.mockRejectedValue(new Error('colo down'));
    colo.delete.mockRejectedValue(new Error('colo down'));
    expect(() => expireBookingSeeds(['svc-gutt'], NOW, 0)).not.toThrow();
    await drainWaitUntil();
  });

  it('deletes a slug deep link’s seed by the service id', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    // /bestill?service=dameklipp — the slug, not the id.
    await loadBookingSeed('dameklipp');
    await drainWaitUntil();
    const slugKey = seedKeyAt('svc-dame,svc-gutt,svc-jente', NOW) ?? '';
    expect(colo.entries.has(slugKey)).toBe(true);

    worker.context?.ctx.waitUntil.mockClear();
    expireBookingSeeds(['svc-dame'], NOW, 0);
    await drainWaitUntil();

    expect(colo.entries.has(slugKey)).toBe(false);
  });

  it('removes, on the second pass, a seed put back after the first delete', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    await loadBookingSeed(undefined);
    await drainWaitUntil();
    const key = seedKeyAt('svc-gutt,svc-jente', NOW) ?? '';
    const stale = colo.entries.get(key);
    expect(stale).toBeDefined();

    worker.context?.ctx.waitUntil.mockClear();
    expireBookingSeeds(['svc-gutt'], NOW, 50);
    // The first pass has deleted it…
    await vi.waitFor(() => expect(colo.entries.has(key)).toBe(false));
    // …then an in-flight build (or a read before the tag expiry landed) puts
    // its pre-booking seed back.
    colo.entries.set(key, stale as { body: string; cacheControl: string | null });

    await drainWaitUntil();

    expect(colo.entries.has(key)).toBe(false);
  });

  it('deletes nothing when no site origin is configured', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expireBookingSeeds(['svc-gutt'], NOW, 0);
    await drainWaitUntil();
    vi.unstubAllEnvs();
    expect(colo.match).not.toHaveBeenCalled();
    expect(colo.delete).not.toHaveBeenCalled();
    expect(cachedServices).not.toHaveBeenCalled();
  });

  it('writes the expiry marker before deleting', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    expireBookingSeeds(['svc-gutt'], NOW, 0);
    await drainWaitUntil();
    const marker = colo.entries.get(expiryMarkerKey('svc-gutt') ?? '');
    expect(marker?.body).toBe(String(NOW));
    expect(marker?.cacheControl).toBe('public, max-age=600');
    const markerPut = colo.put.mock.invocationCallOrder[0];
    expect(colo.delete.mock.invocationCallOrder.every((order) => order > markerPut)).toBe(true);
  });

  it('does not store a seed whose build started before an expire', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    const pending: Array<() => void> = [];
    const release = () => {
      for (const resolve of pending) resolve();
    };
    vi.mocked(cachedAvailability).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(() => resolve([]));
        })
    );
    const building = loadBookingSeed(undefined);
    await vi.waitFor(() => expect(cachedAvailability).toHaveBeenCalledTimes(2));

    // A booking lands while the build is reading Medal.
    expireBookingSeeds(['svc-gutt'], NOW, 0);
    await drainWaitUntil();
    worker.context?.ctx.waitUntil.mockClear();
    release();
    const seed = await building;
    await drainWaitUntil();

    // Served to its own request, not stored for the next one.
    expect(seed.slots).toEqual({ 'svc-gutt': [], 'svc-jente': [] });
    expect(colo.entries.has(seedKeyAt('svc-gutt,svc-jente', NOW) ?? '')).toBe(false);
  });

  it('stores a seed whose build started after the expire', async () => {
    onWorkers();
    uninstall = installColoCache(colo);
    expireBookingSeeds(['svc-gutt'], NOW, 0);
    await drainWaitUntil();

    vi.mocked(Date.now).mockReturnValue(NOW + 1);
    onWorkers();
    await loadBookingSeed(undefined);
    await drainWaitUntil();

    expect(colo.entries.has(seedKeyAt('svc-gutt,svc-jente', NOW + 1) ?? '')).toBe(true);
  });
});

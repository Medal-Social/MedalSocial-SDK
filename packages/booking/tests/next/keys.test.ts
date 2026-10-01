import { describe, expect, it, vi } from 'vitest';

/**
 * KEY PARITY. A site moving onto the package must not lose a cache entry to a
 * renamed key, so the package's keys are compared here with the source site's
 * key code, copied VERBATIM below as the reference (only its environment
 * reads became parameters). Neutral values stand in for the site's own: the
 * format is what is proven, and with the site's prefix and environment the
 * same functions produce the same bytes.
 *
 * L1 (edge) keys are compared whole. L2 (data) keys are `unstable_cache`'s
 * key parts plus the call's arguments — what the source passed — compared
 * call by call. (Next also mixes the cached callback's source text into its
 * own storage key, which no code move can keep; those entries are 30 s to
 * 5 min buckets, so they refill on their own.)
 */

const recorded = vi.hoisted(() => [] as Array<{ keyParts: string[]; args: unknown[] }>);
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[]) =>
    (...args: unknown[]) => {
      recorded.push({ keyParts, args });
      return fn(...args);
    },
  revalidateTag: vi.fn(),
}));

import { createClock } from '../../src/core/clock';
import { nextDataCacheAdapter } from '../../src/next/cache/next-data';
import { workersCacheAdapter } from '../../src/next/cache/workers';
import { createCatalogue } from '../../src/next/catalogue';
import { createSeed } from '../../src/next/seed';
import { createFakeColoCache } from '../support/colo-cache';
import { testLogger } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

// ---------------------------------------------------------------------------
// The reference: the source site's key functions, verbatim apart from the
// three values it read from the environment (origin, app env, worker version).
// ---------------------------------------------------------------------------
const SEED_PATH = '/__medal-edge/booking-seed/v1';
const SEED_BUCKET_MS = 30_000;
const CATALOGUE_BUCKET_MS = 60_000;
const salonDayKey = createClock(PARITY_CONFIG).dayKey;

function reference(origin: string | undefined, appEnv: string | undefined, version?: string) {
  function keyBase(): string | null {
    if (!origin) return null;
    const env = appEnv || 'unknown';
    try {
      return new URL(
        `${SEED_PATH}/${encodeURIComponent(version ? `${env}-${version}` : env)}`,
        origin
      ).toString();
    } catch {
      return null;
    }
  }
  const seedBucket = (now: number) => Math.floor(now / SEED_BUCKET_MS);
  return {
    expiryMarkerKey(serviceId: string): string | null {
      const base = keyBase();
      return base === null ? null : `${base}/gen/${encodeURIComponent(serviceId)}`;
    },
    catalogueKeyAt(now: number): string | null {
      const base = keyBase();
      return base === null ? null : `${base}/catalogue/${Math.floor(now / CATALOGUE_BUCKET_MS)}`;
    },
    catalogueLatestKey(): string | null {
      const base = keyBase();
      return base === null ? null : `${base}/catalogue/latest`;
    },
    seedLatestKeyAt(key: string, now: number): string | null {
      const base = keyBase();
      if (base === null || key === '') return null;
      return `${base}/seed-latest/${salonDayKey(now)}/${key}`;
    },
    seedKeyAt(key: string, now: number): string | null {
      const base = keyBase();
      if (base === null || key === '') return null;
      return `${base}/seed/${salonDayKey(now)}/${key}/${seedBucket(now)}`;
    },
    prefetchKey(targets: readonly { id: string }[]): string {
      return [...new Set(targets.map((target) => target.id))]
        .sort()
        .map(encodeURIComponent)
        .join(',');
    },
  };
}

function packageSeed(origin: string | undefined, environment: string, version?: string) {
  const colo = createFakeColoCache();
  return createSeed(
    {
      config: PARITY_CONFIG,
      cache: {
        edge: workersCacheAdapter({
          origin,
          cache: () => colo.cache,
          context: () => ({ env: version ? { CF_VERSION_METADATA: { id: version } } : {} }),
        }),
        environment,
      },
      logger: testLogger(),
    },
    {
      cachedServices: vi.fn(),
      cachedResources: vi.fn(),
      cachedAvailability: vi.fn(),
      cachedSchedule: vi.fn(),
    }
  );
}

const ORIGINS = [
  'https://salong.example',
  'https://www.salong.example/',
  'https://Salong.Example:443',
];
const ENVIRONMENTS = ['production', 'staging', 'preview-12', ''];
const VERSIONS = [undefined, '5f0c2d1e-0a1b-4c3d-9e8f-123456789abc'];
const IDS = ['svc-1', 'svc_2', 'kj7a9x2m4n8p6q', 'a b', 'ø/æ', '.', '..'];
const INSTANTS = [
  Date.parse('2026-09-02T08:00:07.030+02:00'),
  // Either side of the end of summer time, and of midnight.
  Date.parse('2026-10-25T01:59:59.999+02:00'),
  Date.parse('2026-10-25T02:00:00.000+01:00'),
  Date.parse('2026-12-31T23:59:59.999+01:00'),
];

describe('L1 edge keys are the source site’s, byte for byte', () => {
  for (const origin of ORIGINS) {
    for (const environment of ENVIRONMENTS) {
      for (const version of VERSIONS) {
        it(`${origin} · env «${environment}» · ${version ? 'versioned' : 'unversioned'}`, () => {
          const ours = packageSeed(origin, environment, version);
          const theirs = reference(origin, environment, version);
          expect(ours.catalogueLatestKey()).toBe(theirs.catalogueLatestKey());
          for (const id of IDS) expect(ours.expiryMarkerKey(id)).toBe(theirs.expiryMarkerKey(id));
          const set = ours.prefetchKey(IDS.map((id) => ({ id })));
          expect(set).toBe(theirs.prefetchKey(IDS.map((id) => ({ id }))));
          for (const now of INSTANTS) {
            expect(ours.catalogueKeyAt(now)).toBe(theirs.catalogueKeyAt(now));
            expect(ours.seedKeyAt(set, now)).toBe(theirs.seedKeyAt(set, now));
            expect(ours.seedLatestKeyAt(set, now)).toBe(theirs.seedLatestKeyAt(set, now));
            expect(ours.seedKeyAt('', now)).toBeNull();
          }
        });
      }
    }
  }

  it('the format, spelled out', () => {
    const ours = packageSeed('https://salong.example', 'production', 'v-9');
    const now = INSTANTS[0];
    expect(ours.seedKeyAt('svc-1,svc-2', now)).toBe(
      `https://salong.example/__medal-edge/booking-seed/v1/production-v-9/seed/2026-09-02/svc-1,svc-2/${Math.floor(now / 30_000)}`
    );
  });

  it('no origin, no keys — as the source answered without a base URL', () => {
    const ours = packageSeed(undefined, 'production');
    const theirs = reference(undefined, 'production');
    expect(ours.catalogueKeyAt(INSTANTS[0])).toBe(theirs.catalogueKeyAt(INSTANTS[0]));
    expect(ours.expiryMarkerKey('svc-1')).toBeNull();
  });
});

describe('L2 data keys keep the source site’s key parts and arguments', () => {
  it('services, resources, schedule and availability', async () => {
    const now = Date.parse('2026-09-02T10:07:40+02:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const medal = {
      listServices: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      listAvailability: vi.fn(async () => []),
      listSchedule: vi.fn(async () => []),
    };
    const catalogue = createCatalogue(
      {
        config: PARITY_CONFIG,
        cache: { data: nextDataCacheAdapter(), prefix: 'demo-booking' },
        logger: testLogger(),
      },
      medal
    );
    const to = Date.parse('2026-09-09T00:00:00+02:00');
    await catalogue.cachedServices();
    await catalogue.cachedResources();
    await catalogue.cachedSchedule({ serviceId: 'svc-1', fromTs: now, toTs: to });
    await catalogue.cachedAvailability({ serviceId: 'svc-1', fromTs: now, toTs: to });
    const bucket = Math.floor(now / 300_000);
    const keyFrom = Math.floor(now / 30_000) * 30_000;
    // The source: `[KEY_PREFIX, '<read>']` and these arguments, in this order.
    expect(recorded).toEqual([
      { keyParts: ['demo-booking', 'services'], args: [bucket] },
      { keyParts: ['demo-booking', 'resources'], args: [bucket] },
      { keyParts: ['demo-booking', 'schedule'], args: ['svc-1', keyFrom, to, bucket] },
      {
        keyParts: ['demo-booking', 'availability'],
        args: ['svc-1', keyFrom, to, Math.floor(now / 30_000)],
      },
    ]);
    vi.mocked(Date.now).mockRestore();
  });
});

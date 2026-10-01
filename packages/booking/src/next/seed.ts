/**
 * The booking seed: everything the first two steps of the booking page need,
 * from the edge (L1) cache.
 *
 * WHY. Every read through `catalogue.ts` goes through the data cache, which on
 * OpenNext is the regional Cache API in front of R2 plus a Durable Object round
 * trip for the tag check — 0.25–0.5 s per read even when warm, and the page
 * needed two or three rounds of them. A Workers Cache API read
 * (`caches.default`) is a few milliseconds.
 *
 * WHAT. Two edge entries, read in sequence:
 *
 * - the CATALOGUE — `{ services, resources }` — shared by every prefetch set,
 *   one-minute key bucket;
 * - the SEED for one prefetch set — `{ slots, schedules }` per service over
 *   the page's window — 30-second key bucket.
 *
 * Assembled, `loadBookingSeed` answers `{ services, resources, nextAvailable,
 * schedules, slots, generatedAt }`. The GUARDIAN (cookie-dependent) never goes
 * in; the page reads it on its own.
 *
 * A MISS builds from the `catalogue.ts` loaders, in parallel, so the rounding,
 * the 62-day bypass and every other bound there still applies — the edge entry
 * is one more layer in front, not a second way to ask Medal. An entry is only
 * stored when every part of it was read; a failure is served to this request
 * (absent from the seed, fetched on demand by the wizard) and is not pinned for
 * the next visitor.
 *
 * A HIT is re-filtered to now: an entry up to 30 s old may hold a slot that has
 * since started, and «next free» is derived after that filter.
 *
 * KEYS. `<edgePrefix>/<env>[-<version>]/…`, mapped onto storage keys by the
 * edge adapter (the Workers adapter puts the site's origin in front, because
 * Cache API entries belong to the zone). The environment is in the path
 * because staging and production can share a zone. The seed key holds the
 * local day (the window ends on a local midnight), the SORTED prefetch ids and
 * the 30 s bucket. The prefetch ids are always the output of `prefetchTargets`
 * over the catalogue — a deep link that names no bookable service falls back
 * to the default set — so the number of distinct keys per bucket is at most
 * one per bookable service plus one.
 *
 * STALENESS. A seed is at most 30 s older than the slot entry it was built
 * from, which `catalogue.ts` bounds at ~60 s: ~90 s for a booking made
 * anywhere else. The site's own create / move / cancel (and a SLOT_TAKEN)
 * delete every seed key containing an affected service in this location
 * (`expireBookingSeeds`), and first write a per-service expiry marker so a
 * build already in flight when the write landed does not store its pre-write
 * seed (it still serves it to its own request); in OTHER locations such a seed
 * stays until its bucket turns, ≤30 s. Medal re-checks every slot at submit,
 * and the 409 already carries fresh openings, so a stale seed costs a retry,
 * never a double booking.
 */

import { normaliseCategory } from '../core/categories';
import { createClock } from '../core/clock';
import type { BookingConfig } from '../core/config';
import { serviceMatches } from '../core/deep-link';
import { createDto, toBookingDayDto, toBookingSlotDto } from '../core/dto';
import { firstOpeningPerResource } from '../core/next-available';
import type {
  BookingDayDto,
  BookingResourceDto,
  BookingServiceDto,
  BookingSlotDto,
} from '../core/types';
import type { Catalogue } from './catalogue';
import {
  type BookingCacheAdapter,
  type BookingLogger,
  type BookingTiming,
  DEFAULT_EDGE_PREFIX,
  inBackground,
  timed,
} from './options';

const SEED_BUCKET_MS = 30_000;
const SEED_TTL_S = 30;
const CATALOGUE_BUCKET_MS = 60_000;
const CATALOGUE_TTL_S = 60;

/**
 * STALE-WHILE-REVALIDATE. The bucketed keys above keep a location warm only
 * while visitors keep coming; after a quiet minute the first visitor there
 * paid a full rebuild. So each build is ALSO kept under a «latest» key without
 * the bucket, and a bucket miss serves it at once while one rebuild runs
 * behind the response:
 *
 * - the catalogue (services, stylists) for up to `CATALOGUE_STALE_MAX_S`;
 * - a seed for up to `SEED_STALE_MAX_MS`, and ONLY when no create / move /
 *   cancel handled IN THIS LOCATION has touched its services since it was
 *   built (the expiry markers, kept at least that long, and awaited by the
 *   write routes before they answer). The markers are per location: a booking
 *   handled elsewhere, or made outside this site, can show as open here for at
 *   most `SEED_STALE_MAX_MS` — Medal answers that slot at submit with a 409
 *   carrying fresh openings.
 *
 * One refresh per key at a time in an isolate (`once`), and a refresh never
 * replaces a kept copy built later than its own (`isNewer`), so a burst of
 * visitors to a quiet location costs one rebuild and out-of-order finishes
 * cannot put older openings back.
 */
const CATALOGUE_STALE_MAX_S = 60 * 60;
export const SEED_STALE_MAX_MS = 5 * 60 * 1000;

/**
 * The per-service expiry marker: the instant this location last saw a write
 * to the service (`expireBookingSeeds`). Outlives any seed build and any
 * «latest» seed that could still be served stale (`SEED_STALE_MAX_MS`).
 */
const MARKER_TTL_S = 10 * 60;

/**
 * How long after the first delete the second one runs. The first can land
 * BEFORE the write it answers is visible to a concurrent seed build: the slot
 * tag expiry is written in the platform's deferred work, and a booking-page
 * miss already in flight puts the seed it built from pre-booking slots once it
 * is done. Either puts a stale seed back after the first delete; the second
 * pass removes it. A build that starts after the tag expiry has landed reads
 * live.
 */
export const SEED_RECHECK_MS = 2_000;

export interface BookingCatalogue {
  services: BookingServiceDto[];
  /** `null` when the stylists could not be read; the wizard fetches them. */
  resources: BookingResourceDto[] | null;
}

export interface BookingSeed extends BookingCatalogue {
  slots: Record<string, BookingSlotDto[]>;
  schedules: Record<string, BookingDayDto[]>;
  nextAvailable: Record<string, Record<string, number>>;
  /** When the slot/schedule part was read from `catalogue.ts`. */
  generatedAt: number;
  /** The window the slots and schedules describe. */
  fromTs: number;
  toTs: number;
}

interface StoredSeed {
  slots: Record<string, BookingSlotDto[]>;
  schedules: Record<string, BookingDayDto[]>;
  generatedAt: number;
}

/** How a seed read ended, for `x-booking-seed` and the timing sink. */
export type SeedState = 'hit' | 'stale' | 'miss' | 'bypass';

export interface SeedOptions {
  config: Pick<
    BookingConfig,
    'timeZone' | 'locale' | 'dayparts' | 'window' | 'categories' | 'fallbackCategory' | 'paths'
  >;
  cache: { edge: BookingCacheAdapter; environment: string; edgePrefix?: string };
  logger: BookingLogger;
  timing?: BookingTiming;
}

export interface Seed {
  /** The window the wizard shows and prefetches for, in local days. */
  readonly RANGE_DAYS: number;
  /** How many services to warm the cache with. */
  readonly PREFETCH_LIMIT: number;
  prefetchTargets(services: BookingServiceDto[], named: string | undefined): BookingServiceDto[];
  prefetchKey(targets: readonly { id: string }[]): string;
  seedBucket(now: number): number;
  expiryMarkerKey(serviceId: string): string | null;
  catalogueKeyAt(now: number): string | null;
  catalogueLatestKey(): string | null;
  seedLatestKeyAt(key: string, now: number): string | null;
  seedKeyAt(key: string, now: number): string | null;
  loadBookingCatalogue(now?: number): Promise<BookingCatalogue>;
  loadBookingSeed(named: string | undefined, now?: number): Promise<BookingSeed>;
  allPrefetchKeys(services: BookingServiceDto[]): string[];
  seedKeysFor(services: BookingServiceDto[], serviceIds: Iterable<string>, now: number): string[];
  expireBookingSeeds(
    serviceIds: Iterable<string>,
    now?: number,
    recheckAfterMs?: number
  ): Promise<void>;
  /** Test seam: forget in-flight refreshes. */
  resetSeedRefreshes(): void;
}

type SeedCatalogue = Pick<
  Catalogue,
  'cachedServices' | 'cachedResources' | 'cachedAvailability' | 'cachedSchedule'
>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSeed(options: SeedOptions, catalogue: SeedCatalogue): Seed {
  const { config, logger } = options;
  const { edge } = options.cache;
  const SEED_PATH = options.cache.edgePrefix ?? DEFAULT_EDGE_PREFIX;
  const RANGE_DAYS = config.window.rangeDays;
  const PREFETCH_LIMIT = config.window.prefetchLimit;
  const clock = createClock(config);
  const { toBookingServiceDto, toBookingResourceDto } = createDto(config);

  /** In-flight refreshes by edge key, shared by every request in this isolate. */
  const inflight = new Map<string, Promise<unknown>>();

  function once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const started = work().finally(() => inflight.delete(key));
    inflight.set(key, started);
    return started;
  }

  /** A package key as the adapter stores it, or `null` when it cannot store now. */
  function storageKey(key: string): string | null {
    return edge.key ? edge.key(key) : key;
  }

  function keyBase(): string | null {
    const env = options.cache.environment || 'unknown';
    const version = edge.version?.();
    const base = `${SEED_PATH}/${encodeURIComponent(version ? `${env}-${version}` : env)}`;
    return storageKey(base) === null ? null : base;
  }

  function keyed(path: (base: string) => string): string | null {
    const base = keyBase();
    return base === null ? null : storageKey(path(base));
  }

  /**
   * The services worth prefetching, in order, capped at `PREFETCH_LIMIT`: the
   * one the link names (it is the one the visitor is known to want), then the
   * bookable `window.prefetchCategory` menu. An unknown value is ignored.
   */
  function prefetchTargets(
    services: BookingServiceDto[],
    named: string | undefined
  ): BookingServiceDto[] {
    const linked = named
      ? services.find((service) => service.bookableOnline && serviceMatches(service, named))
      : undefined;
    const prefetchCategory = config.window.prefetchCategory;
    const kids =
      prefetchCategory === null
        ? []
        : services.filter(
            (service) =>
              service.bookableOnline &&
              normaliseCategory(config, service.category) === prefetchCategory &&
              service.id !== linked?.id
          );
    return [...(linked ? [linked] : []), ...kids].slice(0, PREFETCH_LIMIT);
  }

  /** The ids a seed is keyed by: sorted, so the order of the set is not a key. */
  function prefetchKey(targets: readonly { id: string }[]): string {
    return [...new Set(targets.map((target) => target.id))]
      .sort()
      .map(encodeURIComponent)
      .join(',');
  }

  function seedBucket(now: number): number {
    return Math.floor(now / SEED_BUCKET_MS);
  }

  function expiryMarkerKey(serviceId: string): string | null {
    return keyed((base) => `${base}/gen/${encodeURIComponent(serviceId)}`);
  }

  function catalogueKeyAt(now: number): string | null {
    return keyed((base) => `${base}/catalogue/${Math.floor(now / CATALOGUE_BUCKET_MS)}`);
  }

  /** The catalogue kept past its bucket, for a stale-while-revalidate serve. */
  function catalogueLatestKey(): string | null {
    return keyed((base) => `${base}/catalogue/latest`);
  }

  /** One prefetch set's seed kept past its bucket, for the same local day. */
  function seedLatestKeyAt(key: string, now: number): string | null {
    if (key === '') return null;
    return keyed((base) => `${base}/seed-latest/${clock.dayKey(now)}/${key}`);
  }

  /** The seed key for one prefetch set at one instant. */
  function seedKeyAt(key: string, now: number): string | null {
    if (key === '') return null;
    return keyed((base) => `${base}/seed/${clock.dayKey(now)}/${key}/${seedBucket(now)}`);
  }

  async function edgeRead<T>(key: string): Promise<T | undefined> {
    try {
      return await edge.get<T>(key);
    } catch (error) {
      logger.warn({ err: error }, 'Could not read the booking seed from the colo cache');
      return undefined;
    }
  }

  function edgeWrite(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    return inBackground(edge, edge.put(key, value, ttlSeconds));
  }

  /** Whether a copy built at `builtAt` may replace what `key` holds now. */
  async function isNewer(key: string, builtAt: number): Promise<boolean> {
    const kept = await edgeRead<{ generatedAt?: number; builtAt?: number }>(key);
    const keptAt = kept?.generatedAt ?? kept?.builtAt;
    return typeof keptAt !== 'number' || builtAt >= keptAt;
  }

  /**
   * Whether any of `targets` was written to at or after `since` — i.e. a build
   * that started at `since` may hold pre-write openings. A marker that cannot
   * be read counts as «no»: the delete passes and the 30 s bucket still bound
   * it.
   */
  async function expiredSince(targets: readonly { id: string }[], since: number): Promise<boolean> {
    const marks = await Promise.all(
      targets.map(async ({ id }) => {
        const key = expiryMarkerKey(id);
        if (key === null) return null;
        try {
          const hit = await edge.get<unknown>(key);
          return hit === undefined ? null : Number(hit);
        } catch {
          return null;
        }
      })
    );
    return marks.some((mark) => mark !== null && Number.isFinite(mark) && mark >= since);
  }

  async function writeExpiryMarkers(serviceIds: string[], at: number): Promise<void> {
    await Promise.all(
      serviceIds.map(async (id) => {
        const key = expiryMarkerKey(id);
        if (key === null) return;
        try {
          await edge.put(key, at, MARKER_TTL_S);
        } catch (error) {
          logger.warn({ err: error }, 'Could not mark booking seeds expired');
        }
      })
    );
  }

  /** The catalogue straight from `catalogue.ts`. Services failing throws. */
  async function readCatalogue(): Promise<{ catalogue: BookingCatalogue; complete: boolean }> {
    const [services, resources] = await Promise.all([
      catalogue.cachedServices(),
      catalogue.cachedResources().then(
        (list) => list.map(toBookingResourceDto),
        (error: unknown) => {
          logger.warn({ err: error }, 'Could not prefetch the stylists for the booking page');
          return null;
        }
      ),
    ]);
    return {
      catalogue: { services: services.map(toBookingServiceDto), resources },
      complete: resources !== null,
    };
  }

  /**
   * The catalogue, from the edge when there is one. Throws when the services
   * cannot be read — the one failure that replaces the wizard.
   */
  async function loadBookingCatalogue(now: number = Date.now()): Promise<BookingCatalogue> {
    return timed(options.timing, 'catalogue', async () => {
      const key = catalogueKeyAt(now);
      if (key === null) return (await readCatalogue()).catalogue;
      const hit = await edgeRead<BookingCatalogue>(key);
      if (hit && Array.isArray(hit.services)) return hit;
      const refresh = (): Promise<BookingCatalogue> =>
        once(`${key}#refresh`, async () => {
          const builtAt = Date.now();
          const { catalogue: built, complete } = await readCatalogue();
          if (complete && built.services.length > 0) {
            await edgeWrite(key, built, CATALOGUE_TTL_S);
            const latest = catalogueLatestKey();
            if (latest !== null && (await isNewer(latest, builtAt))) {
              await edgeWrite(latest, { ...built, builtAt }, CATALOGUE_STALE_MAX_S);
            }
          }
          return built;
        });
      const latest = catalogueLatestKey();
      const stale = latest === null ? undefined : await edgeRead<BookingCatalogue>(latest);
      if (stale && Array.isArray(stale.services) && stale.services.length > 0) {
        void inBackground(
          edge,
          refresh().catch((error: unknown) => {
            logger.warn({ err: error }, 'Could not refresh the booking catalogue');
          })
        );
        return stale;
      }
      return refresh();
    });
  }

  /** One read per service, best effort per service. */
  async function prefetchEach<T>(
    targets: BookingServiceDto[],
    what: string,
    readOne: (serviceId: string) => Promise<T>
  ): Promise<{ values: Record<string, T>; complete: boolean }> {
    const fetched = await Promise.all(
      targets.map(async (service) => {
        try {
          return [service.id, await readOne(service.id)] as const;
        } catch (error) {
          logger.warn({ err: error, serviceId: service.id }, `Could not prefetch ${what}`);
          return null;
        }
      })
    );
    const entries = fetched.filter((entry) => entry !== null);
    return { values: Object.fromEntries(entries), complete: entries.length === targets.length };
  }

  async function buildSeed(
    targets: BookingServiceDto[],
    fromTs: number,
    toTs: number
  ): Promise<{ seed: StoredSeed; complete: boolean }> {
    const [slots, schedules] = await Promise.all([
      prefetchEach(targets, 'availability', async (serviceId) =>
        (await catalogue.cachedAvailability({ serviceId, fromTs, toTs })).flatMap(toBookingSlotDto)
      ),
      prefetchEach(targets, 'the schedule', async (serviceId) =>
        (await catalogue.cachedSchedule({ serviceId, fromTs, toTs })).flatMap(toBookingDayDto)
      ),
    ]);
    return {
      seed: { slots: slots.values, schedules: schedules.values, generatedAt: fromTs },
      complete: slots.complete && schedules.complete,
    };
  }

  /** A stored seed as of `now`: slots that have started since it was built go. */
  function freshen(seed: StoredSeed, now: number, toTs: number): StoredSeed {
    const slots = Object.fromEntries(
      Object.entries(seed.slots).map(([serviceId, list]) => [
        serviceId,
        list.filter((slot) => slot.startTs >= now && slot.startTs < toTs),
      ])
    );
    return { ...seed, slots };
  }

  /**
   * The seed for the page: the catalogue plus openings and hours for the
   * prefetch set `named` selects. Throws only when the catalogue cannot be read.
   *
   * The state (hit / stale / miss / bypass) goes to the timing sink with the
   * seed phase, for `x-booking-seed`.
   */
  async function loadBookingSeed(
    named: string | undefined,
    now: number = Date.now()
  ): Promise<BookingSeed> {
    const loaded = await loadBookingCatalogue(now);
    const { toTs } = clock.window(now, RANGE_DAYS);
    const targets = prefetchTargets(loaded.services, named);
    let state: SeedState = 'miss';
    const markSeed = (next: SeedState) => {
      state = next;
    };

    const stored = await timed(
      options.timing,
      'seed',
      async (): Promise<StoredSeed> => {
        const key = seedKeyAt(prefetchKey(targets), now);
        if (key === null) {
          markSeed('bypass');
          return (await buildSeed(targets, now, toTs)).seed;
        }
        const hit = await edgeRead<StoredSeed>(key);
        if (hit?.slots && hit.schedules) {
          markSeed('hit');
          return freshen(hit, now, toTs);
        }
        const latestKey = seedLatestKeyAt(prefetchKey(targets), now);
        const rebuild = (): Promise<StoredSeed> =>
          once(`${key}#rebuild`, async () => {
            // Before any Medal read: a write expired at or after this instant
            // may not be in what this build reads, so its seed must not be
            // stored.
            const buildStart = Date.now();
            const { seed, complete } = await buildSeed(targets, now, toTs);
            if (complete && !(await expiredSince(targets, buildStart))) {
              await edgeWrite(key, seed, SEED_TTL_S);
              if (latestKey !== null && (await isNewer(latestKey, seed.generatedAt))) {
                await edgeWrite(latestKey, seed, Math.ceil(SEED_STALE_MAX_MS / 1000));
              }
            }
            return seed;
          });
        const stale = latestKey === null ? undefined : await edgeRead<StoredSeed>(latestKey);
        if (
          stale?.slots &&
          stale.schedules &&
          now - stale.generatedAt < SEED_STALE_MAX_MS &&
          !(await expiredSince(targets, stale.generatedAt))
        ) {
          markSeed('stale');
          void inBackground(
            edge,
            rebuild().catch((error: unknown) => {
              logger.warn({ err: error }, 'Could not refresh the booking seed');
            })
          );
          return freshen(stale, now, toTs);
        }
        markSeed('miss');
        return rebuild();
      },
      () => ({ state })
    );

    // Only alongside a stylist list: «next free» with nobody to hang it on is
    // not a seed the wizard can use, and it fetches both together instead.
    const nextAvailable =
      loaded.resources === null
        ? {}
        : Object.fromEntries(
            Object.entries(stored.slots).map(([serviceId, slots]) => [
              serviceId,
              firstOpeningPerResource(slots),
            ])
          );

    return {
      ...loaded,
      slots: stored.slots,
      schedules: stored.schedules,
      nextAvailable,
      generatedAt: stored.generatedAt,
      fromTs: now,
      toTs,
    };
  }

  /**
   * Every prefetch set the page can key a seed by: the default one and one per
   * bookable service a deep link can name. Deterministic from the catalogue.
   */
  function allPrefetchKeys(services: BookingServiceDto[]): string[] {
    const sets = [
      prefetchTargets(services, undefined),
      ...services
        .filter((service) => service.bookableOnline)
        .map((service) => prefetchTargets(services, service.id)),
    ];
    return [...new Set(sets.filter((set) => set.length > 0).map(prefetchKey))];
  }

  /**
   * The edge keys to delete after a write touching `serviceIds`: every prefetch
   * set containing one of them, in the current and the previous 30 s bucket (a
   * seed from the previous bucket can still be read by a request that started
   * in it). Sets not containing an affected service are left alone.
   */
  function seedKeysFor(
    services: BookingServiceDto[],
    serviceIds: Iterable<string>,
    now: number
  ): string[] {
    const affected = new Set(serviceIds);
    if (affected.size === 0) return [];
    const keys = allPrefetchKeys(services).filter((key) =>
      key.split(',').some((id) => affected.has(decodeURIComponent(id)))
    );
    const instants = [now, now - SEED_BUCKET_MS];
    return [
      ...new Set(
        keys
          .flatMap((key) => [
            ...instants.map((at) => seedKeyAt(key, at)),
            // The kept copy too: it must not be served stale after this write.
            seedLatestKeyAt(key, now),
          ])
          .filter((k) => k !== null)
      ),
    ];
  }

  async function deleteSeeds(serviceIds: string[], now: number): Promise<void> {
    const current = catalogueKeyAt(now);
    const previous = catalogueKeyAt(now - CATALOGUE_BUCKET_MS);
    // Nothing can be keyed: no seed was ever stored, so nothing to delete.
    if (current === null || previous === null) return;
    const kept =
      (await edgeRead<BookingCatalogue>(current)) ?? (await edgeRead<BookingCatalogue>(previous));
    const services = Array.isArray(kept?.services)
      ? kept.services
      : (await catalogue.cachedServices()).map(toBookingServiceDto);
    await edge.delete(seedKeysFor(services, serviceIds, now));
  }

  /**
   * Mark `serviceIds` expired (so an in-flight build started before now does
   * not store its seed), then delete this location's seeds containing any of
   * them, after a create / move / cancel or a SLOT_TAKEN — twice, the second
   * time `recheckAfterMs` later (see `SEED_RECHECK_MS`). The deletes run on the
   * adapter's `defer`, so they add nothing to the response; best effort — the
   * write has already happened and the 30 s bucket is the backstop. A no-op
   * when the edge adapter cannot store anything.
   */
  function expireBookingSeeds(
    serviceIds: Iterable<string>,
    now: number = Date.now(),
    recheckAfterMs: number = SEED_RECHECK_MS
  ): Promise<void> {
    const ids = [...new Set(serviceIds)];
    if (ids.length === 0 || keyBase() === null) return Promise.resolve();
    const pass = (at: number) =>
      deleteSeeds(ids, at).catch((error: unknown) => {
        logger.warn({ err: error }, 'Could not expire booking seeds');
      });
    // The marker first, and returned: a write route awaits it before
    // answering, so no kept seed from before the write passes `expiredSince`
    // in this location once the visitor has their confirmation. The deletes
    // follow in the background.
    const marked = writeExpiryMarkers(ids, now);
    void inBackground(
      edge,
      (async () => {
        await marked;
        await pass(now);
        await sleep(recheckAfterMs);
        // Re-derived at the time of the second pass: if the bucket turned in
        // between, the first pass's bucket is now the «previous» one.
        await pass(now + recheckAfterMs);
      })()
    );
    return marked;
  }

  return {
    RANGE_DAYS,
    PREFETCH_LIMIT,
    prefetchTargets,
    prefetchKey,
    seedBucket,
    expiryMarkerKey,
    catalogueKeyAt,
    catalogueLatestKey,
    seedLatestKeyAt,
    seedKeyAt,
    loadBookingCatalogue,
    loadBookingSeed,
    allPrefetchKeys,
    seedKeysFor,
    expireBookingSeeds,
    resetSeedRefreshes: () => inflight.clear(),
  };
}

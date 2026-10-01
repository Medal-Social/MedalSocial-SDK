/**
 * A short-lived data cache in front of Medal's booking READS (the L2 cache).
 *
 * The booking page and the wizard's route handlers would otherwise ask Medal
 * live on every request, which is most of a one-second TTFB and most of the
 * wait after a service tap. It reads through `options.cache.data`: with the
 * `next-data` adapter that is `unstable_cache` (on OpenNext, the incremental
 * cache — R2 plus the Durable Object tag cache), shared across isolates and
 * visitors.
 *
 * `unstable_cache` is stale-while-revalidate: an expired entry is served once
 * more while it refills. So every key also carries TIME — the slot key a 30 s
 * bucket, the catalogue keys a five-minute one — and a key that has moved on
 * is a miss, not a stale hit. The resulting bounds:
 *
 * - free slots (tag `booking-slots:<serviceId>`): at most ~60 s old. The
 *   site's own create / move / cancel expire the tag at once (`expireSlots`);
 *   the bound is what covers a booking made anywhere else;
 * - the catalogue (services, stylists, opening hours; tag `booking-catalogue`):
 *   at most ~10 min old.
 *
 * KEYS. Every entry is keyed `[prefix, '<read>']` plus its arguments, the
 * scheme the first site on this package already uses, so its key parts stay
 * the same when `prefix` does.
 *
 * A failed read throws and is not cached, so a Medal blip is not pinned.
 */

import { createClock } from '../core/clock';
import type { BookingConfig } from '../core/config';
import type { MedalResource, MedalScheduleDay, MedalService, MedalSlot } from '../core/wire';
import type { MedalSeam, RangeArgs } from './medal';
import { type BookingCacheAdapter, type BookingLogger, cacheLoad } from './options';

export const CATALOGUE_TAG = 'booking-catalogue';
const CATALOGUE_TTL_S = 300;
const SLOTS_TTL_S = 30;

/** The slot key step, and the catalogue's time bucket. */
const SLOT_KEY_STEP_MS = 30 * 1000;
const CATALOGUE_BUCKET_MS = 5 * 60 * 1000;

/** How far ahead a cached read may reach; beyond it the read is live. Matches
 * the 62-day range bound the routes put on a query string. */
const MAX_KEY_AHEAD_MS = 62 * 24 * 60 * 60 * 1000;

/** `{ fresh: true }` skips the cache for one read and writes no entry. Server
 * callers only — the create route's live re-read after a `slotTaken`; no
 * route lets a visitor ask for it. */
export interface ReadOptions {
  fresh?: boolean;
}

export function slotsTag(serviceId: string): string {
  return `booking-slots:${serviceId}`;
}

/**
 * Where a slot key starts: the later of the caller's `from` and now, floored to
 * 30 s. Unrounded, no two visitors would share an entry; not clamped to now,
 * any past instant would be a key of its own.
 */
export function slotKeyStart(fromTs: number, now: number = Date.now()): number {
  return Math.floor(Math.max(fromTs, now) / SLOT_KEY_STEP_MS) * SLOT_KEY_STEP_MS;
}

function catalogueBucket(now: number): number {
  return Math.floor(now / CATALOGUE_BUCKET_MS);
}

export interface Catalogue {
  cachedServices(): Promise<MedalService[]>;
  cachedResources(): Promise<MedalResource[]>;
  cachedSchedule(args: RangeArgs): Promise<MedalScheduleDay[]>;
  cachedAvailability(args: RangeArgs, options?: ReadOptions): Promise<MedalSlot[]>;
  expireSlots(serviceIds: Iterable<string>): void;
}

export interface CatalogueOptions {
  config: Pick<BookingConfig, 'timeZone' | 'locale' | 'dayparts'>;
  cache: { data: BookingCacheAdapter; prefix: string };
  logger: BookingLogger;
}

type Seam = Pick<MedalSeam, 'listServices' | 'listResources' | 'listAvailability' | 'listSchedule'>;

export function createCatalogue(options: CatalogueOptions, medal: Seam): Catalogue {
  const { data } = options.cache;
  const KEY_PREFIX = options.cache.prefix;
  const clock = createClock(options.config);

  /** `ts` if it is a local midnight, otherwise the next one. */
  function roundUpToDay(ts: number): number {
    const start = clock.dayStart(ts);
    return start === ts ? ts : clock.dayStart(ts, 1);
  }

  /**
   * The range a read is CACHED under, or `null` for a read that must go live.
   *
   * The range comes from a visitor's query string, so the key is normalised to
   * a small set of values — otherwise every distinct `from_ts`/`to_ts` would be
   * a Medal call and a cache write:
   *
   * - `from` is `slotKeyStart` (the later of it and now, floored to 30 s);
   * - `to` rounded UP to a local midnight — the booking page's window already
   *   ends on one, so it is unchanged there;
   * - a key reaching more than 62 days ahead is not cached at all;
   * - a stylist-narrowed read (the manage page's) is not cached at all.
   *
   * The caller's real bounds are applied to the answer afterwards.
   */
  function keyRange(args: RangeArgs, now: number): { fromTs: number; toTs: number } | null {
    if (args.resourceId) return null;
    const fromTs = slotKeyStart(args.fromTs, now);
    const toTs = roundUpToDay(args.toTs);
    const limit = now + MAX_KEY_AHEAD_MS;
    if (fromTs > limit || toTs > limit || toTs <= fromTs) return null;
    return { fromTs, toTs };
  }

  function cachedServices(): Promise<MedalService[]> {
    return cacheLoad(
      data,
      [KEY_PREFIX, 'services'],
      [catalogueBucket(Date.now())],
      () => medal.listServices(),
      {
        ttlSeconds: CATALOGUE_TTL_S,
        tags: [CATALOGUE_TAG],
      }
    );
  }

  function cachedResources(): Promise<MedalResource[]> {
    return cacheLoad(
      data,
      [KEY_PREFIX, 'resources'],
      [catalogueBucket(Date.now())],
      () => medal.listResources(),
      { ttlSeconds: CATALOGUE_TTL_S, tags: [CATALOGUE_TAG] }
    );
  }

  /**
   * Opening hours per service (the cutoffs are per service) over a range.
   *
   * The key range can end after the one asked about, so dates outside the
   * caller's real range are dropped.
   */
  async function cachedSchedule(args: RangeArgs): Promise<MedalScheduleDay[]> {
    const now = Date.now();
    const key = keyRange(args, now);
    if (key === null) return medal.listSchedule(args);
    const { serviceId } = args;
    const days = await cacheLoad(
      data,
      [KEY_PREFIX, 'schedule'],
      [serviceId, key.fromTs, key.toTs, catalogueBucket(now)],
      () => medal.listSchedule({ serviceId, fromTs: key.fromTs, toTs: key.toTs }),
      { ttlSeconds: CATALOGUE_TTL_S, tags: [CATALOGUE_TAG] }
    );
    const firstDay = clock.dayKey(args.fromTs);
    // The local day holding the last instant before `toTs` is the last one
    // asked about; a day starting at or after `toTs` was not.
    const lastDay = clock.dayKey(args.toTs - 1);
    // `date` is ISO `YYYY-MM-DD`, so string order is date order. A null date is
    // left for `toBookingDayDto`, which already drops it.
    return days.filter((day) => day.date === null || (day.date >= firstDay && day.date <= lastDay));
  }

  /**
   * Free slots for one service. The tag names the service; the key is the
   * same for every call with the same arguments.
   *
   * Only slots starting inside the caller's real `[fromTs, toTs)` AND not
   * before now are returned: the key reaches forward to the next local
   * midnight, and an entry up to a minute old may still hold a slot that has
   * since started.
   */
  async function cachedAvailability(
    args: RangeArgs,
    readOptions: ReadOptions = {}
  ): Promise<MedalSlot[]> {
    const now = Date.now();
    const key = readOptions.fresh ? null : keyRange(args, now);
    let slots: MedalSlot[];
    if (key === null) {
      slots = await medal.listAvailability(args);
    } else {
      const { serviceId } = args;
      // The time bucket as well as the start: a FUTURE `from` (the manage
      // page's) keys a start that never moves, and the bucket still retires it.
      slots = await cacheLoad(
        data,
        [KEY_PREFIX, 'availability'],
        [serviceId, key.fromTs, key.toTs, Math.floor(now / SLOT_KEY_STEP_MS)],
        () => medal.listAvailability({ serviceId, fromTs: key.fromTs, toTs: key.toTs }),
        { ttlSeconds: SLOTS_TTL_S, tags: [slotsTag(serviceId)] }
      );
    }
    const earliest = Math.max(args.fromTs, now);
    return slots.filter((slot) => {
      // Unreadable starts are kept for `toBookingSlotDto`, which drops them.
      if (slot.start_ts === null) return true;
      const startTs = Date.parse(slot.start_ts);
      return !Number.isFinite(startTs) || (startTs >= earliest && startTs < args.toTs);
    });
  }

  /**
   * Expire the cached slots of every service a write just touched, so the next
   * read — this visitor's confirmation, the next visitor's time step — is live.
   *
   * Best effort: the write has already happened, and a cache that could not be
   * expired must not turn a made booking into an error. The ~60 s bound above
   * is the backstop.
   */
  function expireSlots(serviceIds: Iterable<string>): void {
    for (const serviceId of new Set(serviceIds)) {
      const warn = (error: unknown) =>
        options.logger.warn({ err: error, serviceId }, 'Could not expire cached booking slots');
      try {
        data.expireTag?.(slotsTag(serviceId))?.catch(warn);
      } catch (error) {
        warn(error);
      }
    }
  }

  return { cachedServices, cachedResources, cachedSchedule, cachedAvailability, expireSlots };
}

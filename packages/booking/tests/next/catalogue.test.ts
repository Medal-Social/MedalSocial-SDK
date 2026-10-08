import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The short-lived data cache in front of Medal's booking reads.
 *
 * `unstable_cache` needs Next's incremental cache, which vitest has none of, so
 * it is replaced by a pass-through that records what each loader was cached
 * WITH — the key the arguments form, the TTL and the tags. Those three are the
 * whole behaviour: two visitors share an entry only if their keys match, and a
 * booking only frees a slot on screen if the tag it expires is the tag the
 * slots were stored under.
 */
const cache = vi.hoisted(() => ({
  calls: [] as Array<{ keyParts?: string[]; options?: { revalidate?: number; tags?: string[] } }>,
  invocations: [] as unknown[][],
  revalidateTag: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts?: string[],
    options?: { revalidate?: number; tags?: string[] }
  ) => {
    const entry = { keyParts, options };
    cache.calls.push(entry);
    return (...args: unknown[]) => {
      cache.invocations.push([entry, ...args]);
      return fn(...args);
    };
  },
  revalidateTag: cache.revalidateTag,
}));

import { nextDataCacheAdapter } from '../../src/next/cache/next-data';
import { CATALOGUE_TAG, createCatalogue, slotKeyStart, slotsTag } from '../../src/next/catalogue';
import { testLogger } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

/** The seam the catalogue reads through, as fakes the tests drive. */
const listServices = vi.fn();
const listResources = vi.fn();
const listAvailability = vi.fn();
const listSchedule = vi.fn();

const { cachedAvailability, cachedResources, cachedSchedule, cachedServices, expireSlots } =
  createCatalogue(
    {
      config: PARITY_CONFIG,
      cache: { data: nextDataCacheAdapter(), prefix: 'demo-booking' },
      logger: testLogger(),
    },
    { listServices, listResources, listAvailability, listSchedule }
  );

const STEP = 30 * 1000;
/** 10:07:40 Oslo on a Wednesday — deliberately NOT on a 30-second boundary. */
const NOW = Date.parse('2026-09-02T10:07:40+02:00');
const KEY_FROM = Date.parse('2026-09-02T10:07:30+02:00');
/** The catalogue's five-minute time bucket at NOW. */
const BUCKET = Math.floor(NOW / (5 * 60 * 1000));
/** The slot loader's 30-second time bucket at NOW. */
const SLOT_BUCKET = Math.floor(NOW / STEP);
const TO = Date.parse('2026-09-09T00:00:00+02:00');

/** The options the most recent invocation of a loader was cached with. */
function lastInvocation() {
  const [entry, ...args] = cache.invocations.at(-1) as [
    { keyParts?: string[]; options?: { revalidate?: number; tags?: string[] } },
    ...unknown[],
  ];
  return { ...entry, args };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  cache.invocations.length = 0;
  cache.revalidateTag.mockReset();
  vi.mocked(listServices).mockReset().mockResolvedValue([]);
  vi.mocked(listResources).mockReset().mockResolvedValue([]);
  vi.mocked(listAvailability).mockReset().mockResolvedValue([]);
  vi.mocked(listSchedule).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

describe('slotKeyStart', () => {
  it('floors the later of from and now to 30 s, so visitors seconds apart share a key', () => {
    expect(slotKeyStart(NOW, NOW)).toBe(KEY_FROM);
    expect(slotKeyStart(KEY_FROM, KEY_FROM)).toBe(KEY_FROM);
    expect(slotKeyStart(KEY_FROM + STEP - 1, NOW)).toBe(KEY_FROM);
    expect(slotKeyStart(KEY_FROM + STEP, NOW)).toBe(KEY_FROM + STEP);
    // A past `from` keys on now, not on an instant of its own.
    expect(slotKeyStart(NOW - 86_400_000, NOW)).toBe(KEY_FROM);
  });
});

describe('catalogue reads', () => {
  it('caches services and stylists for five minutes under the catalogue tag', async () => {
    await cachedServices();
    expect(lastInvocation().options).toEqual({ revalidate: 300, tags: [CATALOGUE_TAG] });
    await cachedResources();
    expect(lastInvocation().options).toEqual({ revalidate: 300, tags: [CATALOGUE_TAG] });
    expect(CATALOGUE_TAG).toBe('booking-catalogue');
  });

  it('keys the catalogue on a five-minute time bucket, so an idle first hit is a miss', async () => {
    // Stale-while-revalidate would otherwise serve an entry of any age once.
    await cachedServices();
    expect(lastInvocation().args).toEqual([BUCKET]);
    await cachedResources();
    expect(lastInvocation().args).toEqual([BUCKET]);

    vi.mocked(Date.now).mockReturnValue(NOW + 5 * 60 * 1000);
    await cachedServices();
    expect(lastInvocation().args).toEqual([BUCKET + 1]);
  });

  it('gives services and stylists different keys, so neither answers for the other', async () => {
    await cachedServices();
    const services = lastInvocation().keyParts;
    await cachedResources();
    expect(lastInvocation().keyParts).not.toEqual(services);
  });
});

describe('cachedAvailability', () => {
  it('asks Medal from the rounded instant and caches for thirty seconds per service', async () => {
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });

    expect(listAvailability).toHaveBeenCalledWith({
      serviceId: 'svc-gutt',
      fromTs: KEY_FROM,
      toTs: TO,
    });
    const invocation = lastInvocation();
    expect(invocation.options).toEqual({ revalidate: 30, tags: ['booking-slots:svc-gutt'] });
    expect(invocation.args).toEqual(['svc-gutt', KEY_FROM, TO, SLOT_BUCKET]);
  });

  it('forms the same key for two visitors inside one 30-second step, and a new one after', async () => {
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });
    const first = lastInvocation();
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW + 15_000, toTs: TO });
    const second = lastInvocation();

    expect(second.keyParts).toEqual(first.keyParts);
    expect(second.args).toEqual(first.args);

    // Half a minute on, the key has moved: an entry cannot be served past it.
    vi.mocked(Date.now).mockReturnValue(NOW + STEP);
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });
    expect(lastInvocation().args).toEqual(['svc-gutt', KEY_FROM + STEP, TO, SLOT_BUCKET + 1]);
  });

  it('moves the key every 30 s even when from lies in the future', async () => {
    // The manage page asks from a point before the booking, which can be days
    // ahead: `max(from, now)` is then `from` and never moves, so only the time
    // bucket stops a stale-while-revalidate entry of any age being served.
    const future = Date.parse('2026-09-05T09:00:00+02:00');
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: future, toTs: TO });
    const first = lastInvocation().args;

    vi.mocked(Date.now).mockReturnValue(NOW + STEP);
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: future, toTs: TO });
    const second = lastInvocation().args;

    expect(first).toEqual(['svc-gutt', future, TO, SLOT_BUCKET]);
    expect(second).toEqual(['svc-gutt', future, TO, SLOT_BUCKET + 1]);
  });

  it('never hands back a slot earlier than the instant actually asked about', async () => {
    // The rounded key reaches back up to 30 s. A slot in that gap is in the
    // past for this visitor, and offering it is a booking that will fail.
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-02T08:07:35.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T08:07:40.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T08:30:00.000Z', end_ts: null, resource_id: 'r2' },
    ]);

    const slots = await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });

    expect(slots.map((slot) => slot.start_ts)).toEqual([
      '2026-09-02T08:07:40.000Z',
      '2026-09-02T08:30:00.000Z',
    ]);
  });

  it('never hands back a slot that has already started, whatever from the caller sent', async () => {
    // The wizard's window is pinned when the page rendered, so its `from` can
    // be long gone; a cached entry up to a minute old can also still hold a
    // slot that has since begun.
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-02T08:00:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T08:30:00.000Z', end_ts: null, resource_id: 'r2' },
    ]);

    const slots = await cachedAvailability({
      serviceId: 'svc-gutt',
      fromTs: NOW - 3_600_000,
      toTs: TO,
    });

    expect(slots.map((slot) => slot.start_ts)).toEqual(['2026-09-02T08:30:00.000Z']);
  });

  it('reads live and writes no entry when asked for a fresh read', async () => {
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO }, { fresh: true });

    expect(cache.invocations).toHaveLength(0);
    expect(listAvailability).toHaveBeenCalledWith({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });
  });

  it('rounds an end up to the right midnight across the October clock change', async () => {
    // 25 October 2026 is 25 hours long in Oslo: CEST until 03:00, CET after.
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-10-24T10:00:00+02:00'));
    const afternoon = Date.parse('2026-10-25T14:00:00+01:00');
    const midnightAfter = Date.parse('2026-10-26T00:00:00+01:00');
    const midnightBefore = Date.parse('2026-10-25T00:00:00+02:00');

    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: 0, toTs: afternoon });
    expect(lastInvocation().args[2]).toBe(midnightAfter);

    // Already a midnight, on either side of the change: left alone.
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: 0, toTs: midnightBefore });
    expect(lastInvocation().args[2]).toBe(midnightBefore);
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: 0, toTs: midnightAfter });
    expect(lastInvocation().args[2]).toBe(midnightAfter);
  });

  it('reads a stylist-narrowed request live, with the caller’s own bounds', async () => {
    // Only the manage page narrows by stylist; caching it would be one entry
    // per stylist per booking.
    await cachedAvailability({ serviceId: 'svc-gutt', resourceId: 'r1', fromTs: NOW, toTs: TO });

    expect(listAvailability).toHaveBeenCalledWith({
      serviceId: 'svc-gutt',
      resourceId: 'r1',
      fromTs: NOW,
      toTs: TO,
    });
    expect(cache.invocations).toHaveLength(0);
  });

  it('keys an unaligned end on the next salon midnight, and drops slots from the real end on', async () => {
    // The manage page's shape: `to_ts` is a booking time plus a look-ahead,
    // so it is a different instant for every booking.
    const midDay = Date.parse('2026-09-04T13:20:00+02:00');
    const nextMidnight = Date.parse('2026-09-05T00:00:00+02:00');
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-04T11:00:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-04T11:20:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-04T12:00:00.000Z', end_ts: null, resource_id: 'r1' },
    ]);

    const slots = await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: midDay });

    expect(lastInvocation().args).toEqual(['svc-gutt', KEY_FROM, nextMidnight, SLOT_BUCKET]);
    expect(slots.map((slot) => slot.start_ts)).toEqual(['2026-09-04T11:00:00.000Z']);

    // A different end on the same day shares the entry.
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: midDay + 3_600_000 });
    expect(lastInvocation().args).toEqual(['svc-gutt', KEY_FROM, nextMidnight, SLOT_BUCKET]);
  });

  it('never keys on a start earlier than the current 30-second step', async () => {
    const yesterday = NOW - 24 * 60 * 60 * 1000;

    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: yesterday, toTs: TO });
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: yesterday - 777, toTs: TO });

    expect(cache.invocations.map(([, ...args]) => args)).toEqual([
      ['svc-gutt', KEY_FROM, TO, SLOT_BUCKET],
      ['svc-gutt', KEY_FROM, TO, SLOT_BUCKET],
    ]);
  });

  it('reads live, uncached, when the range reaches more than 62 days ahead', async () => {
    const day = 24 * 60 * 60 * 1000;
    const farTo = Date.parse('2026-11-10T00:00:00+02:00');
    expect(farTo - NOW).toBeGreaterThan(62 * day);

    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: NOW, toTs: farTo });
    await cachedAvailability({ serviceId: 'svc-gutt', fromTs: farTo - day, toTs: farTo });
    await cachedSchedule({ serviceId: 'svc-gutt', fromTs: NOW, toTs: farTo });

    expect(cache.invocations).toHaveLength(0);
    expect(listAvailability).toHaveBeenLastCalledWith({
      serviceId: 'svc-gutt',
      fromTs: farTo - day,
      toTs: farTo,
    });
    expect(listSchedule).toHaveBeenCalledWith({ serviceId: 'svc-gutt', fromTs: NOW, toTs: farTo });
  });
});

describe('cachedSchedule', () => {
  it('caches opening hours for five minutes under the catalogue tag, from the rounded key', async () => {
    await cachedSchedule({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });

    expect(listSchedule).toHaveBeenCalledWith({
      serviceId: 'svc-gutt',
      fromTs: KEY_FROM,
      toTs: TO,
    });
    expect(lastInvocation().options).toEqual({ revalidate: 300, tags: [CATALOGUE_TAG] });
  });

  it('drops a day before the one asked about', async () => {
    // A cached entry is shared, so it may carry dates this caller did not ask for.
    const justAfterMidnight = Date.parse('2026-09-03T00:02:00+02:00');
    vi.mocked(listSchedule).mockResolvedValue([
      { date: '2026-09-02', opens_ts: null, closes_ts: null, last_start_ts: null },
      { date: '2026-09-03', opens_ts: null, closes_ts: null, last_start_ts: null },
    ] as never);

    const days = await cachedSchedule({
      serviceId: 'svc-gutt',
      fromTs: justAfterMidnight,
      toTs: TO,
    });

    expect(days.map((day) => day.date)).toEqual(['2026-09-03']);
  });

  it('keys an unaligned end on the next salon midnight, and drops days from the real end on', async () => {
    const midDay = Date.parse('2026-09-04T13:20:00+02:00');
    vi.mocked(listSchedule).mockResolvedValue([
      { date: '2026-09-03', opens_ts: null, closes_ts: null, last_start_ts: null },
      { date: '2026-09-04', opens_ts: null, closes_ts: null, last_start_ts: null },
      { date: '2026-09-05', opens_ts: null, closes_ts: null, last_start_ts: null },
    ] as never);

    const days = await cachedSchedule({ serviceId: 'svc-gutt', fromTs: NOW, toTs: midDay });

    expect(lastInvocation().args).toEqual([
      'svc-gutt',
      KEY_FROM,
      Date.parse('2026-09-05T00:00:00+02:00'),
      BUCKET,
    ]);
    // The 4th was asked about (up to 13:20); the 5th was not.
    expect(days.map((day) => day.date)).toEqual(['2026-09-03', '2026-09-04']);
  });

  it('drops the day that starts exactly at an aligned end', async () => {
    vi.mocked(listSchedule).mockResolvedValue([
      { date: '2026-09-08', opens_ts: null, closes_ts: null, last_start_ts: null },
      { date: '2026-09-09', opens_ts: null, closes_ts: null, last_start_ts: null },
    ] as never);

    const days = await cachedSchedule({ serviceId: 'svc-gutt', fromTs: NOW, toTs: TO });

    expect(days.map((day) => day.date)).toEqual(['2026-09-08']);
  });

  it('reads a stylist-narrowed schedule live', async () => {
    await cachedSchedule({ serviceId: 'svc-gutt', resourceId: 'r1', fromTs: NOW, toTs: TO });

    expect(listSchedule).toHaveBeenCalledWith({
      serviceId: 'svc-gutt',
      resourceId: 'r1',
      fromTs: NOW,
      toTs: TO,
    });
    expect(cache.invocations).toHaveLength(0);
  });
});

describe('a visit of several services', () => {
  const VISIT = { serviceId: 'svc-cut', extraServiceIds: ['svc-wash', 'svc-style'] };

  it('keys availability on the visit, asks Medal for all of it, and tags every service', async () => {
    await cachedAvailability({ ...VISIT, fromTs: NOW, toTs: TO });

    expect(listAvailability).toHaveBeenCalledWith({ ...VISIT, fromTs: KEY_FROM, toTs: TO });
    const invocation = lastInvocation();
    expect(invocation.args).toEqual(['svc-cut+svc-wash+svc-style', KEY_FROM, TO, SLOT_BUCKET]);
    // So a write to ANY of the three retires the visit's entry.
    expect(invocation.options).toEqual({
      revalidate: 30,
      tags: [slotsTag('svc-cut'), slotsTag('svc-wash'), slotsTag('svc-style')],
    });
  });

  it('keeps a one-service key byte-identical, an empty extras list included', async () => {
    await cachedAvailability({ serviceId: 'svc-cut', extraServiceIds: [], fromTs: NOW, toTs: TO });

    expect(lastInvocation().args).toEqual(['svc-cut', KEY_FROM, TO, SLOT_BUCKET]);
    expect(lastInvocation().options?.tags).toEqual([slotsTag('svc-cut')]);
    // Nothing about extras reaches the seam for a one-service read.
    expect(listAvailability).toHaveBeenCalledWith({
      serviceId: 'svc-cut',
      fromTs: KEY_FROM,
      toTs: TO,
    });
    expect(Object.keys(vi.mocked(listAvailability).mock.calls[0][0])).not.toContain(
      'extraServiceIds'
    );

    await cachedSchedule({ serviceId: 'svc-cut', extraServiceIds: [], fromTs: NOW, toTs: TO });
    expect(lastInvocation().args).toEqual(['svc-cut', KEY_FROM, TO, BUCKET]);
  });

  it('gives a visit and its first service different entries', async () => {
    await cachedAvailability({ serviceId: 'svc-cut', fromTs: NOW, toTs: TO });
    const alone = lastInvocation().args;
    await cachedAvailability({ ...VISIT, fromTs: NOW, toTs: TO });

    expect(lastInvocation().args).not.toEqual(alone);
  });

  it('keys the schedule on the visit and asks Medal for all of it', async () => {
    await cachedSchedule({ ...VISIT, fromTs: NOW, toTs: TO });

    expect(listSchedule).toHaveBeenCalledWith({ ...VISIT, fromTs: KEY_FROM, toTs: TO });
    expect(lastInvocation().args).toEqual(['svc-cut+svc-wash+svc-style', KEY_FROM, TO, BUCKET]);
    expect(lastInvocation().options).toEqual({ revalidate: 300, tags: [CATALOGUE_TAG] });
  });

  it('passes the visit through to a live read', async () => {
    await cachedAvailability({ ...VISIT, fromTs: NOW, toTs: TO }, { fresh: true });

    expect(cache.invocations).toHaveLength(0);
    expect(listAvailability).toHaveBeenCalledWith({ ...VISIT, fromTs: NOW, toTs: TO });
  });
});

describe('expireSlots', () => {
  it('expires each affected service once, immediately', () => {
    expireSlots(['svc-gutt', 'svc-jente', 'svc-gutt']);

    expect(cache.revalidateTag).toHaveBeenCalledTimes(2);
    expect(cache.revalidateTag).toHaveBeenCalledWith(slotsTag('svc-gutt'), { expire: 0 });
    expect(cache.revalidateTag).toHaveBeenCalledWith(slotsTag('svc-jente'), { expire: 0 });
  });

  it('never turns a booking that happened into a failure', () => {
    cache.revalidateTag.mockImplementation(() => {
      throw new Error('no store');
    });

    expect(() => expireSlots(['svc-gutt'])).not.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The routes read through the real catalogue (`src/next/catalogue.ts`) over
 * the `next-data` adapter, whose `unstable_cache` needs Next's incremental
 * cache. A pass-through here keeps every assertion below about the route, and
 * records the TTLs and tags so the cache wiring itself is asserted too.
 */
const cacheOptions = vi.hoisted(() => [] as Array<{ revalidate?: number; tags?: string[] }>);
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown, _key: unknown, options: { tags?: string[] }) =>
    (...args: unknown[]) => {
      cacheOptions.push(options);
      return fn(...args);
    },
  revalidateTag: vi.fn(),
}));

import { nextDataCacheAdapter } from '../../../src/next/cache/next-data';
import { noopCacheAdapter } from '../../../src/next/cache/noop';
import { MedalApiError, MedalConfigError } from '../../../src/next/medal';
import {
  availabilityRoute,
  resourcesRoute,
  scheduleRoute,
  servicesRoute,
} from '../../../src/next/routes/catalogue-routes';
import { testRuntime } from '../../support/next-runtime';

/** The Medal seam's four reads; the real catalogue cache sits in front of them. */
const listServices = vi.fn();
const listResources = vi.fn();
const listAvailability = vi.fn();
const listSchedule = vi.fn();

const rt = testRuntime(
  { medal: { listServices, listResources, listAvailability, listSchedule } as never },
  {
    cache: {
      data: nextDataCacheAdapter(),
      edge: noopCacheAdapter(),
      prefix: 'demo-booking',
      environment: 'unknown',
    },
  }
);

const getServices = () => servicesRoute(rt);
const getResources = (request: Request) => resourcesRoute(rt, request);
const getAvailability = (request: Request) => availabilityRoute(rt, request);
const getSchedule = (request: Request) => scheduleRoute(rt, request);

const CATALOGUE = [
  {
    id: 'a',
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
  },
  {
    id: 'b',
    name: 'Hull i ørene',
    description: null,
    category: 'annet',
    duration_minutes: 15,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    price_ore: 30_000,
    bookable_online: false,
    max_per_booking: 1,
    weekend_surcharge_pct: null,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window most requests below ask about: from the pinned «now» (1 September
 * 2026, 00:00 UTC) to an Oslo midnight a week on — a range the cache keys on
 * unchanged, and one the fixtures' September slots fall inside.
 */
const FROM = Date.UTC(2026, 8, 1);
const TO = Date.parse('2026-09-08T00:00:00+02:00');

function availabilityRequest(query: Record<string, string>): Request {
  const params = new URLSearchParams(query);
  return new Request(`https://salong.example/api/booking/availability?${params}`);
}

const STYLISTS = [
  {
    id: 'r1',
    name: 'Sara',
    photo_url: 'https://cdn.example.com/sara.jpg',
    bio: 'Rolig med de minste',
    service_ids: ['a', 'b'],
    sort_order: 2,
  },
  {
    id: 'r2',
    name: 'Marcus',
    photo_url: null,
    bio: null,
    service_ids: ['a'],
    sort_order: 1,
  },
];

function resourcesRequest(query: Record<string, string> = {}): Request {
  const params = new URLSearchParams(query);
  return new Request(`https://salong.example/api/booking/resources?${params}`);
}

function scheduleRequest(query: Record<string, string>): Request {
  const params = new URLSearchParams(query);
  return new Request(`https://salong.example/api/booking/schedule?${params}`);
}

/**
 * The cache drops slots that have already started, so «now» is pinned before
 * every fixture below (1 September 2026) rather than read off the host.
 */
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 1));
  cacheOptions.length = 0;
  // The read routes check `service_id` against the catalogue before it reaches
  // a cache key; 'a' and 'b' are the services every request below names.
  vi.mocked(listServices).mockReset().mockResolvedValue(CATALOGUE);
  vi.mocked(listResources).mockReset();
  vi.mocked(listAvailability).mockReset();
  vi.mocked(listSchedule).mockReset();
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

describe('GET /api/booking/services', () => {
  it('keeps a phone-only service in the list, flagged — the price list stays complete', async () => {
    // J1 step 1: a service toggled off for online booking shows its card with
    // «Ring oss for denne» tap-to-call rather than vanishing. Filtering it out
    // here would silently punch a hole in the salon's published prices, and
    // nothing downstream would be in a position to notice.
    vi.mocked(listServices).mockResolvedValue(CATALOGUE);

    const body = await (await getServices()).json();

    const names = body.services.map((service: { name: string }) => service.name);
    expect(names).toEqual(['Gutteklipp', 'Hull i ørene']);
    expect(body.services[1].bookableOnline).toBe(false);
  });

  it('hands the wizard camelCase, so no wire shape reaches the browser', async () => {
    vi.mocked(listServices).mockResolvedValue(CATALOGUE);

    const body = await (await getServices()).json();

    expect(body.services[0]).toEqual({
      id: 'a',
      name: 'Gutteklipp',
      category: 'barn',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      priceOre: 49_000,
      maxPerBooking: 3,
      weekendSurchargePct: 10,
      bookableOnline: true,
    });
  });

  it('resolves every null to a default, because null poisons the maths downstream', async () => {
    // The serialiser emits `value ?? null` for every field, so a service the
    // salon half-filled arrives complete but empty. `priceOre: null` renders as
    // «kr null»; `maxPerBooking: null` is the nastier one, because
    // `partyLimit` does `Math.min(null, …)` and `Number(null)` is 0 — a party
    // limit of zero, silently, on a service the salon meant to be bookable.
    vi.mocked(listServices).mockResolvedValue([
      {
        id: 'c',
        name: null,
        description: null,
        category: null,
        duration_minutes: null,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        price_ore: null,
        bookable_online: true,
        max_per_booking: null,
        weekend_surcharge_pct: null,
      },
    ]);

    const body = await (await getServices()).json();

    expect(body.services[0]).toEqual({
      id: 'c',
      name: '',
      category: 'annet',
      durationMinutes: 0,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      priceOre: 0,
      maxPerBooking: 1,
      weekendSurchargePct: 0,
      bookableOnline: true,
    });
  });

  it('answers 503 unconfigured when the deployment has no API key', async () => {
    vi.mocked(listServices).mockRejectedValue(
      new MedalConfigError('MEDAL_API_KEY is not configured')
    );

    const response = await getServices();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
  });

  it("relays Medal's status and code but never its message", async () => {
    // Medal writes its error bodies for the integrator holding the API key:
    // they name workspaces, ids and internal fields. The code alone is enough
    // for the browser to act on.
    vi.mocked(listServices).mockRejectedValue(
      new MedalApiError(403, 'FORBIDDEN', 'Workspace jd7exs… is not entitled to bookings')
    );

    const response = await getServices();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'FORBIDDEN' });
    expect(JSON.stringify(body)).not.toContain('jd7exs');
  });

  it('answers 502 for a failure it has no mapping for', async () => {
    vi.mocked(listServices).mockRejectedValue(new TypeError('fetch failed'));

    const response = await getServices();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstreamError' });
  });
});

describe('GET /api/booking/availability', () => {
  it('gives the wizard epoch milliseconds, not the ISO strings Medal returns', async () => {
    // `formatBookingSlot` runs every timestamp through `toISOString()`, but
    // `pickSlot` stores `startTs` as a number and the sticky summary bar
    // formats it with `Intl.DateTimeFormat.format`. Relaying the string would
    // put one into `state.startTs`, and the bar would throw on the visitor's
    // very next keystroke.
    vi.mocked(listAvailability).mockResolvedValue([
      {
        start_ts: '2026-09-02T09:00:00.000Z',
        end_ts: '2026-09-02T09:30:00.000Z',
        resource_id: 'r1',
      },
    ]);

    const body = await (
      await getAvailability(
        availabilityRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.slots).toEqual([{ startTs: Date.UTC(2026, 8, 2, 9), resourceId: 'r1' }]);
  });

  it('drops a slot with no start time rather than emitting NaN', async () => {
    // `start_ts` is nullable on the wire like everything else. A NaN reaching
    // `pickSlot` is a chip that renders «Invalid Date» and books nothing.
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: null, end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T09:00:00.000Z', end_ts: null, resource_id: null },
    ]);

    const body = await (
      await getAvailability(
        availabilityRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.slots).toEqual([{ startTs: Date.UTC(2026, 8, 2, 9), resourceId: null }]);
  });

  it('narrows to one stylist when step 2 asked for one', async () => {
    // `state.resourceId` is the visitor's preference and the thing that filters
    // this query. Dropping it would show every stylist's slots on step 3 after
    // the visitor picked Nadia on step 2.
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getAvailability(
      availabilityRequest({
        service_id: 'a',
        from_ts: String(FROM),
        to_ts: String(TO),
        resource_id: 'r1',
      })
    );

    expect(vi.mocked(listAvailability).mock.calls[0][0]).toEqual({
      serviceId: 'a',
      resourceId: 'r1',
      fromTs: FROM,
      toTs: TO,
    });
  });

  it('refuses a range wider than 62 days here rather than paying for the round trip', async () => {
    const response = await getAvailability(
      availabilityRequest({ service_id: 'a', from_ts: '0', to_ts: String(63 * DAY_MS) })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalidInput');
    expect(body.message).toContain('62');
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('refuses a request with no service_id before calling Medal', async () => {
    const response = await getAvailability(
      availabilityRequest({ from_ts: String(FROM), to_ts: String(TO) })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalidInput');
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('refuses a range that ends before it starts', async () => {
    const response = await getAvailability(
      availabilityRequest({ service_id: 'a', from_ts: String(DAY_MS), to_ts: '0' })
    );

    expect(response.status).toBe(400);
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('refuses bounds it cannot read as a time, instead of asking Medal about NaN', async () => {
    // Unguarded, `new Date(NaN).toISOString()` throws inside the client and the
    // catch-all turns a typo in a query string into an opaque 502.
    const response = await getAvailability(
      availabilityRequest({ service_id: 'a', from_ts: 'i-mrgen', to_ts: String(DAY_MS) })
    );

    expect(response.status).toBe(400);
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('accepts ISO bounds as well as epoch milliseconds', async () => {
    // The same two forms the engine's own `parseTimestampQueryParam` takes, so
    // a value this route accepts is one Medal would have accepted too.
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getAvailability(
      availabilityRequest({
        service_id: 'a',
        // Oslo midnights, so the cache keys on them unchanged.
        from_ts: '2026-09-01T22:00:00.000Z',
        to_ts: '2026-09-02T22:00:00.000Z',
      })
    );

    expect(vi.mocked(listAvailability).mock.calls[0][0]).toMatchObject({
      fromTs: Date.UTC(2026, 8, 1, 22),
      toTs: Date.UTC(2026, 8, 2, 22),
    });
  });

  it('maps a Medal failure the same way the services route does', async () => {
    vi.mocked(listAvailability).mockRejectedValue(new MedalConfigError('no key'));

    const response = await getAvailability(
      availabilityRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
  });
});

/**
 * The route that lets step 3 stop calling a shut salon «Fullt».
 *
 * Availability answers what can still be booked, and its empty array says three
 * things at once — closed today, past closing today, every chair taken today.
 * This route is the other half, and everything below is about not losing the
 * distinction on the way through.
 */
describe('GET /api/booking/schedule', () => {
  it('gives the wizard epoch milliseconds and the salon’s own date key', async () => {
    vi.mocked(listSchedule).mockResolvedValue([
      {
        date: '2026-09-02',
        opens_ts: '2026-09-02T08:00:00.000Z',
        closes_ts: '2026-09-02T15:00:00.000Z',
        last_start_ts: '2026-09-02T14:30:00.000Z',
      },
    ]);

    const body = await (
      await getSchedule(
        scheduleRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    // `dayKey` is relayed as the string Medal computed in the salon's zone —
    // re-deriving it here from `opensTs` would file an 08:00 opening under the
    // previous day for any viewer west of Oslo.
    expect(body.days).toEqual([
      {
        dayKey: '2026-09-02',
        opensTs: Date.UTC(2026, 8, 2, 8),
        closesTs: Date.UTC(2026, 8, 2, 15),
        lastStartTs: Date.UTC(2026, 8, 2, 14, 30),
      },
    ]);
  });

  it('keeps a shut day, because null there is an answer and not a gap', async () => {
    // A public holiday: the salon posts Wednesday hours and is closed anyway.
    // Dropping the row would say it keeps no Wednesday hours at all, which is a
    // different sentence — and one that would survive the holiday.
    vi.mocked(listSchedule).mockResolvedValue([
      {
        date: '2026-09-02',
        opens_ts: '2026-09-02T08:00:00.000Z',
        closes_ts: '2026-09-02T15:00:00.000Z',
        last_start_ts: null,
      },
    ]);

    const body = await (
      await getSchedule(
        scheduleRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.days).toEqual([
      {
        dayKey: '2026-09-02',
        opensTs: Date.UTC(2026, 8, 2, 8),
        closesTs: Date.UTC(2026, 8, 2, 15),
        lastStartTs: null,
      },
    ]);
  });

  it('drops a day it cannot read rather than emitting NaN', async () => {
    // The two failures are not symmetric. A dropped day reads downstream as
    // «the salon keeps no hours then» and shows «Stengt» — visible, and it
    // costs a tap. A NaN `opensTs` reads as OPEN, compares false against every
    // clock check the step makes, and falls through to «Fullt» — the exact
    // false claim about the business this route exists to stop.
    vi.mocked(listSchedule).mockResolvedValue([
      {
        date: null,
        opens_ts: '2026-09-02T08:00:00.000Z',
        closes_ts: '2026-09-02T15:00:00.000Z',
        last_start_ts: '2026-09-02T14:30:00.000Z',
      },
      { date: '2026-09-03', opens_ts: 'not a date', closes_ts: null, last_start_ts: null },
      {
        date: '2026-09-04',
        opens_ts: '2026-09-04T08:00:00.000Z',
        closes_ts: '2026-09-04T15:00:00.000Z',
        last_start_ts: '2026-09-04T14:30:00.000Z',
      },
    ]);

    const body = await (
      await getSchedule(
        scheduleRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.days).toEqual([
      {
        dayKey: '2026-09-04',
        opensTs: Date.UTC(2026, 8, 4, 8),
        closesTs: Date.UTC(2026, 8, 4, 15),
        lastStartTs: Date.UTC(2026, 8, 4, 14, 30),
      },
    ]);
  });

  it('narrows to one stylist when step 2 asked for one', async () => {
    // Opening hours are per-resource: a salon open six days a week may have one
    // stylist who works Tuesdays and Thursdays, so «stengt» is only ever true
    // of a day for the person being asked about.
    vi.mocked(listSchedule).mockResolvedValue([]);

    await getSchedule(
      scheduleRequest({
        service_id: 'a',
        resource_id: 'r1',
        from_ts: String(FROM),
        to_ts: String(TO),
      })
    );

    expect(listSchedule).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'r1' }));
  });

  it('omits a blank stylist rather than passing the empty string on', async () => {
    // `?resource_id=` with nothing after it is «Første ledige», and the client
    // would otherwise put the blank into the query it builds for Medal.
    vi.mocked(listSchedule).mockResolvedValue([]);

    await getSchedule(
      scheduleRequest({
        service_id: 'a',
        resource_id: '',
        from_ts: String(FROM),
        to_ts: String(TO),
      })
    );

    expect(vi.mocked(listSchedule).mock.calls[0][0]).not.toHaveProperty('resourceId');
  });

  it('refuses a request with no service_id before calling Medal', async () => {
    // The last bookable start of a day depends on the service's duration and
    // buffers, so there is no salon-wide answer to give.
    const response = await getSchedule(
      scheduleRequest({ from_ts: String(FROM), to_ts: String(TO) })
    );

    expect(response.status).toBe(400);
    expect(listSchedule).not.toHaveBeenCalled();
  });

  it('applies the same range guards as the availability route', async () => {
    const wide = await getSchedule(
      scheduleRequest({ service_id: 'a', from_ts: '0', to_ts: String(63 * DAY_MS) })
    );
    const backwards = await getSchedule(
      scheduleRequest({ service_id: 'a', from_ts: String(DAY_MS), to_ts: '0' })
    );
    const unreadable = await getSchedule(
      scheduleRequest({ service_id: 'a', from_ts: 'yesterday', to_ts: 'today' })
    );

    expect([wide.status, backwards.status, unreadable.status]).toEqual([400, 400, 400]);
    expect(listSchedule).not.toHaveBeenCalled();
  });

  it('maps a Medal failure the same way the other read routes do', async () => {
    vi.mocked(listSchedule).mockRejectedValue(new MedalConfigError('no key'));
    const unconfigured = await getSchedule(
      scheduleRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
    );
    expect(unconfigured.status).toBe(503);

    vi.mocked(listSchedule).mockRejectedValue(new MedalApiError(429, 'RATE_LIMITED', 'slow down'));
    const throttled = await getSchedule(
      scheduleRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
    );
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ error: 'RATE_LIMITED' });
  });
});

describe('GET /api/booking/resources', () => {
  it('hands step 2 camelCase, so no wire shape reaches the browser', async () => {
    vi.mocked(listResources).mockResolvedValue(STYLISTS);

    const body = await (await getResources(resourcesRequest())).json();

    expect(body.resources[0]).toEqual({
      id: 'r1',
      name: 'Sara',
      // This site's cacheable proxy, never Medal's re-signed presigned URL.
      photoUrl: '/api/booking/avatar/r1',
      bio: 'Rolig med de minste',
      serviceIds: ['a', 'b'],
      sortOrder: 2,
    });
  });

  it('puts a stylist with no sort order last rather than first', async () => {
    // Step 2 sorts ascending. Coalescing a null to 0 — which every
    // falsy-flavoured default does — would put the salon's least configured
    // stylist above the person they deliberately ordered first.
    vi.mocked(listResources).mockResolvedValue([
      { id: 'r3', name: 'Nadia', photo_url: null, bio: null, service_ids: [], sort_order: null },
      ...STYLISTS,
    ]);

    const body = await (await getResources(resourcesRequest())).json();

    const unordered = body.resources.find((r: { id: string }) => r.id === 'r3');
    const ordered = body.resources.find((r: { id: string }) => r.id === 'r2');
    expect(unordered.sortOrder).toBeGreaterThan(ordered.sortOrder);
  });

  it('answers the earliest opening per stylist, not the first one in the list', async () => {
    // «Neste ledige: i morgen 09:00» is the FIRST minute each stylist is free.
    // Medal returns slots in its own order, so a route that took whichever row
    // it happened to see first would promise a later time than the salon has.
    vi.mocked(listResources).mockResolvedValue(STYLISTS);
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-02T14:00:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T09:00:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-03T11:00:00.000Z', end_ts: null, resource_id: 'r2' },
    ]);

    const body = await (
      await getResources(
        resourcesRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.nextAvailableTs).toEqual({
      r1: Date.UTC(2026, 8, 2, 9),
      r2: Date.UTC(2026, 8, 3, 11),
    });
  });

  it('asks about every stylist at once, never narrowed to one', async () => {
    // Passing `resource_id` through would collapse the answer to whoever was
    // named, and every other card's «Neste ledige» would vanish the moment the
    // visitor picked somebody on step 2.
    vi.mocked(listResources).mockResolvedValue(STYLISTS);
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getResources(
      resourcesRequest({
        service_id: 'a',
        from_ts: String(FROM),
        to_ts: String(TO),
        resource_id: 'r1',
      })
    );

    expect(vi.mocked(listAvailability).mock.calls[0][0]).toEqual({
      serviceId: 'a',
      fromTs: FROM,
      toTs: TO,
    });
  });

  it('drops a slot with no stylist or no start rather than inventing a line', async () => {
    // A slot with no `resource_id` fills nobody's line; an unparseable start
    // would render «Neste ledige: Invalid Date» — the one string on step 2 that
    // makes a working salon look broken.
    vi.mocked(listResources).mockResolvedValue(STYLISTS);
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-02T09:00:00.000Z', end_ts: null, resource_id: null },
      { start_ts: null, end_ts: null, resource_id: 'r1' },
      { start_ts: 'i morgen', end_ts: null, resource_id: 'r2' },
    ]);

    const body = await (
      await getResources(
        resourcesRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
      )
    ).json();

    expect(body.nextAvailableTs).toEqual({});
  });

  it('still lists the stylists when availability is the thing that failed', async () => {
    // Best effort, and never fatal: a list with no «Neste ledige» lines is a
    // working step 2 — «Første ledige» is on it and is the default — where a
    // 502 here would be a step with nobody on it and no way past.
    vi.mocked(listResources).mockResolvedValue(STYLISTS);
    vi.mocked(listAvailability).mockRejectedValue(new MedalApiError(429, 'RATE_LIMITED', 'slow'));

    const response = await getResources(
      resourcesRequest({ service_id: 'a', from_ts: String(FROM), to_ts: String(TO) })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources).toHaveLength(2);
    expect(body.nextAvailableTs).toEqual({});
  });

  it('does not ask about availability at all without a service to ask about', async () => {
    vi.mocked(listResources).mockResolvedValue(STYLISTS);

    const body = await (await getResources(resourcesRequest())).json();

    expect(listAvailability).not.toHaveBeenCalled();
    expect(body.nextAvailableTs).toEqual({});
  });

  it('refuses a range it cannot read, before either call to Medal', async () => {
    vi.mocked(listResources).mockResolvedValue(STYLISTS);

    const response = await getResources(
      resourcesRequest({ service_id: 'a', from_ts: 'i-mrgen', to_ts: String(DAY_MS) })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalidInput');
    expect(listResources).not.toHaveBeenCalled();
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('refuses a range wider than 62 days, the same as the availability route', async () => {
    vi.mocked(listResources).mockResolvedValue(STYLISTS);

    const response = await getResources(
      resourcesRequest({ service_id: 'a', from_ts: '0', to_ts: String(63 * DAY_MS) })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('62');
    expect(listResources).not.toHaveBeenCalled();
  });

  it('maps a stylist-list failure the same way the other read routes do', async () => {
    vi.mocked(listResources).mockRejectedValue(new MedalConfigError('no key'));

    const response = await getResources(resourcesRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
  });
});

/**
 * The reads go through the short-lived cache: `from` rounded down to the
 * five-minute key, and the stylist list and «Neste ledige» asked for together.
 */
describe('booking reads through the cache', () => {
  /** 10:07:30 Oslo — deliberately off the five-minute grid. */
  const OFF_GRID = Date.parse('2026-09-02T10:07:40+02:00');
  const ON_GRID = Date.parse('2026-09-02T10:07:30+02:00');
  const range = { service_id: 'a', from_ts: String(OFF_GRID), to_ts: String(OFF_GRID + DAY_MS) };

  // The cache never keys on a start before «now», so «now» is the request's.
  beforeEach(() => {
    vi.mocked(Date.now).mockReturnValue(OFF_GRID);
  });

  it('asks Medal for availability from the shared key, cached per service', async () => {
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getAvailability(availabilityRequest(range));

    expect(vi.mocked(listAvailability).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(cacheOptions).toContainEqual({ revalidate: 30, tags: ['booking-slots:a'] });
  });

  it('asks Medal for the schedule from the shared key, cached with the catalogue', async () => {
    vi.mocked(listSchedule).mockResolvedValue([]);

    await getSchedule(scheduleRequest(range));

    expect(vi.mocked(listSchedule).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(cacheOptions).toContainEqual({ revalidate: 300, tags: ['booking-catalogue'] });
  });

  it('reads the services list through the catalogue cache', async () => {
    vi.mocked(listServices).mockResolvedValue(CATALOGUE);

    await getServices();

    expect(cacheOptions).toContainEqual({ revalidate: 300, tags: ['booking-catalogue'] });
  });

  it('asks for the stylists and their next openings at once, and availability only once', async () => {
    let releaseResources: (value: typeof STYLISTS) => void = () => {};
    vi.mocked(listResources).mockReturnValue(
      new Promise((resolve) => {
        releaseResources = resolve;
      })
    );
    vi.mocked(listAvailability).mockResolvedValue([
      { start_ts: '2026-09-02T09:00:00.000Z', end_ts: null, resource_id: 'r1' },
    ]);

    const pending = getResources(resourcesRequest(range));
    // Availability is asked before the stylist list has answered: in parallel,
    // not one round trip after the other.
    await vi.waitFor(() => expect(listAvailability).toHaveBeenCalledTimes(1));
    releaseResources(STYLISTS);
    const body = await (await pending).json();

    expect(listAvailability).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listAvailability).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(body.nextAvailableTs).toEqual({ r1: Date.UTC(2026, 8, 2, 9) });
  });
});

/**
 * `service_id` becomes part of a cache key and a cache tag, so a visitor may
 * only name a service the salon actually has.
 */
describe('service_id guard on the read routes', () => {
  const ok = { from_ts: String(FROM), to_ts: String(TO) };
  const routes = [
    ['availability', (q: Record<string, string>) => getAvailability(availabilityRequest(q))],
    ['schedule', (q: Record<string, string>) => getSchedule(scheduleRequest(q))],
    ['resources', (q: Record<string, string>) => getResources(resourcesRequest(q))],
  ] as const;

  for (const [name, call] of routes) {
    it(`/${name} refuses a service the catalogue does not have, before asking Medal about it`, async () => {
      vi.mocked(listResources).mockResolvedValue(STYLISTS);

      const response = await call({ service_id: 'svc-nope', ...ok });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalidInput');
      expect(listAvailability).not.toHaveBeenCalled();
      expect(listSchedule).not.toHaveBeenCalled();
    });

    it(`/${name} refuses a malformed service_id without even reading the catalogue`, async () => {
      for (const bad of ['a b', 'x'.repeat(65), '../a', 'a%00']) {
        const response = await call({ service_id: bad, ...ok });
        expect(response.status).toBe(400);
      }
      expect(listServices).not.toHaveBeenCalled();
    });
  }

  it('maps a catalogue failure during the check the way the read routes do', async () => {
    vi.mocked(listServices).mockRejectedValue(new MedalConfigError('no key'));

    const response = await getAvailability(availabilityRequest({ service_id: 'a', ...ok }));

    expect(response.status).toBe(503);
    expect(listAvailability).not.toHaveBeenCalled();
  });
});

/**
 * There is no public cache bypass: a query flag any visitor can set would let
 * every request skip the cache. `fresh=1` is ignored — the read is cached like
 * any other. (After a `slotTaken` the create route itself returns live slots.)
 */
describe('fresh=1 is not a cache bypass', () => {
  const OFF_GRID = Date.parse('2026-09-02T10:07:40+02:00');
  const ON_GRID = Date.parse('2026-09-02T10:07:30+02:00');
  const range = { service_id: 'a', from_ts: String(OFF_GRID), to_ts: String(OFF_GRID + DAY_MS) };

  beforeEach(() => {
    vi.mocked(Date.now).mockReturnValue(OFF_GRID);
  });

  it('leaves /availability reading through the cache', async () => {
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getAvailability(availabilityRequest({ ...range, fresh: '1' }));

    expect(vi.mocked(listAvailability).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(cacheOptions).toContainEqual({ revalidate: 30, tags: ['booking-slots:a'] });
  });

  it('leaves /schedule and the resources route’s next openings reading through the cache', async () => {
    vi.mocked(listSchedule).mockResolvedValue([]);
    vi.mocked(listResources).mockResolvedValue(STYLISTS);
    vi.mocked(listAvailability).mockResolvedValue([]);

    await getSchedule(scheduleRequest({ ...range, fresh: '1' }));
    await getResources(resourcesRequest({ ...range, fresh: '1' }));

    expect(vi.mocked(listSchedule).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(vi.mocked(listAvailability).mock.calls[0][0]).toMatchObject({ fromTs: ON_GRID });
    expect(cacheOptions).toContainEqual({ revalidate: 30, tags: ['booking-slots:a'] });
    expect(cacheOptions).toContainEqual({ revalidate: 300, tags: ['booking-catalogue'] });
  });
});

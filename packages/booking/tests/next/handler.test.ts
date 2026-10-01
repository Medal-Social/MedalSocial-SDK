import { describe, expect, it, vi } from 'vitest';
import { createBookingHandlerFor } from '../../src/next/handler';
import { testCookieJar, testRuntime } from '../support/next-runtime';

/**
 * The dispatcher: every booking and portal sub-route reaches its handler on
 * the right method, everything else gets a plain 404 / 405, and the app's
 * rate limiter is asked before anything is read. What each route DOES is its
 * own suite's (`tests/next/routes`).
 */

const ORIGIN = 'https://salong.example';

function catalogue() {
  return {
    cachedServices: vi.fn(async () => [
      {
        id: 'svc-1',
        name: 'Klipp',
        description: null,
        category: 'barn',
        duration_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        price_ore: 40_000,
        bookable_online: true,
        max_per_booking: 3,
        weekend_surcharge_pct: null,
      },
    ]),
    cachedResources: vi.fn(async () => []),
    cachedAvailability: vi.fn(async () => []),
    cachedSchedule: vi.fn(async () => []),
    expireSlots: vi.fn(),
  };
}

function handlerWith(options: Parameters<typeof testRuntime>[1] = {}) {
  const parts = {
    catalogue: catalogue(),
    seed: {
      loadBookingSeed: vi.fn(async () => ({ slots: {} })),
      expireBookingSeeds: vi.fn(async () => {}),
    },
    medal: {
      getManage: vi.fn(async () => {
        throw Object.assign(new Error('gone'), { status: 404 });
      }),
    },
    session: {
      readPortalSession: vi.fn(async () => null),
      clearPortalSession: vi.fn(async () => {}),
    },
    flash: { clearVippsLinkFlash: vi.fn(async () => {}) },
  };
  const rt = testRuntime(parts as never, { cookies: testCookieJar().source, ...options });
  return { handler: createBookingHandlerFor(rt), parts };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: unknown = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { origin: ORIGIN },
  });

describe('createBookingHandler — booking routes', () => {
  it('answers the catalogue reads on GET', async () => {
    const { handler, parts } = handlerWith();
    const services = await handler.GET(get('/api/booking/services'));
    expect(services.status).toBe(200);
    expect((await services.json()).services[0].id).toBe('svc-1');
    expect((await handler.GET(get('/api/booking/resources'))).status).toBe(200);
    expect(parts.catalogue.cachedResources).toHaveBeenCalled();
    const range = 'service_id=svc-1&from_ts=1000&to_ts=2000';
    expect((await handler.GET(get(`/api/booking/availability?${range}`))).status).toBe(200);
    expect((await handler.GET(get(`/api/booking/schedule?${range}`))).status).toBe(200);
    expect(parts.catalogue.cachedAvailability).toHaveBeenCalled();
    expect(parts.catalogue.cachedSchedule).toHaveBeenCalled();
    const nextFree = await handler.GET(get('/api/booking/next-free'));
    expect(await nextFree.json()).toEqual({ startTs: null, label: null });
  });

  it('takes a trailing slash as the same route', async () => {
    const { handler } = handlerWith();
    expect((await handler.GET(get('/api/booking/services/'))).status).toBe(200);
  });

  it('decodes the avatar id and the manage token from the path', async () => {
    const { handler, parts } = handlerWith();
    // Unknown stylist: the avatar route's own 404.
    expect((await handler.GET(get('/api/booking/avatar/res-1'))).status).toBe(404);
    // A token that needed encoding reaches the seam decoded.
    await handler.GET(get('/api/booking/manage/a%2Bb'));
    expect(parts.medal.getManage).toHaveBeenCalledWith('a+b');
  });

  it('routes create and manage writes on POST', async () => {
    const { handler } = handlerWith();
    const created = await handler.POST(post('/api/booking/create', { items: [] }));
    expect(created.status).toBe(400);
    expect((await created.json()).error).toBe('invalidInput');
    const managed = await handler.POST(post('/api/booking/manage/tok', { action: 'nope' }));
    expect(managed.status).toBe(400);
  });

  it('refuses a malformed segment, an empty one, and a nested one', async () => {
    const { handler } = handlerWith();
    const malformed = await handler.GET(get('/api/booking/manage/%E0%A4%A'));
    expect(malformed.status).toBe(400);
    expect((await handler.GET(get('/api/booking/manage/'))).status).toBe(404);
    expect((await handler.GET(get('/api/booking/manage/a/b'))).status).toBe(404);
    expect((await handler.GET(get('/api/booking/nothing/here'))).status).toBe(404);
  });
});

describe('createBookingHandler — portal routes', () => {
  it('routes each portal path on its method', async () => {
    const { handler, parts } = handlerWith();
    // No session: touch is a 401, persons a 401, expired a 303 to the login.
    expect((await handler.POST(post('/api/portal/session/touch'))).status).toBe(401);
    expect((await handler.POST(post('/api/portal/persons'))).status).toBe(401);
    const expired = await handler.GET(get('/api/portal/session/expired'));
    expect(expired.status).toBe(303);
    expect(expired.headers.get('Location')).toBe(`${ORIGIN}/min-side/logg-inn`);
    // A malformed body: the verify routes' own 400s.
    expect((await handler.POST(post('/api/portal/login/verify'))).status).toBe(400);
    expect((await handler.POST(post('/api/portal/vipps/link/verify'))).status).toBe(400);
    const flash = await handler.DELETE(
      new Request(`${ORIGIN}/api/portal/vipps/flash`, { method: 'DELETE' })
    );
    expect(flash.status).toBe(204);
    expect(parts.flash.clearVippsLinkFlash).toHaveBeenCalled();
  });

  it('is a 404 for a portal path it does not know', async () => {
    const { handler } = handlerWith();
    expect((await handler.POST(post('/api/portal/login/start'))).status).toBe(404);
  });
});

describe('createBookingHandler — everything else', () => {
  it('is a 404 outside both prefixes, including the bare prefix', async () => {
    const { handler } = handlerWith();
    for (const path of ['/api/booking', '/api/bookingx/services', '/elsewhere']) {
      const response = await handler.GET(get(path));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'notFound' });
    }
  });

  it('is a 405 naming the methods the route takes', async () => {
    const { handler } = handlerWith();
    const wrong = await handler.POST(post('/api/booking/services'));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('GET');
    const manage = await handler.DELETE(
      new Request(`${ORIGIN}/api/booking/manage/tok`, { method: 'DELETE' })
    );
    expect(manage.headers.get('Allow')).toBe('GET, POST');
  });

  it('asks the app’s rate limiter first, by route scope, and answers 429 for it', async () => {
    const rateLimit = vi.fn(async (scope: string) => scope === 'booking/create');
    const { handler, parts } = handlerWith({ rateLimit });
    const limited = await handler.POST(post('/api/booking/create', {}));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rateLimited' });
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect((await handler.GET(get('/api/booking/services'))).status).toBe(200);
    expect(rateLimit.mock.calls.map(([scope]) => scope)).toEqual([
      'booking/create',
      'booking/services',
    ]);
    expect(parts.catalogue.expireSlots).not.toHaveBeenCalled();
    // Unknown paths and wrong methods never reach the limiter.
    await handler.GET(get('/elsewhere'));
    await handler.POST(post('/api/booking/services'));
    expect(rateLimit).toHaveBeenCalledTimes(2);
  });

  it('dispatches on the configured prefixes, not hard-coded ones', async () => {
    const config = {
      ...testRuntime().config,
      paths: { ...testRuntime().config.paths, api: '/booking-api/', portalApi: '/account-api' },
    };
    const { handler } = handlerWith({ config });
    expect((await handler.GET(get('/booking-api/services'))).status).toBe(200);
    expect((await handler.GET(get('/api/booking/services'))).status).toBe(404);
    expect((await handler.POST(post('/account-api/session/touch'))).status).toBe(401);
  });
});

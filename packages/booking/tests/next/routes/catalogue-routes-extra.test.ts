import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedalApiError } from '../../../src/next/medal';
import {
  availabilityRoute,
  avatarRoute,
  nextFreeRoute,
  resourcesRoute,
} from '../../../src/next/routes/catalogue-routes';
import { testLogger, testRuntime } from '../../support/next-runtime';

/**
 * The branches the moved suites do not reach: the read routes over a fake
 * catalogue, so each guard is asserted on its own.
 */

const cachedServices = vi.fn();
const cachedResources = vi.fn();
const cachedAvailability = vi.fn();
const loadBookingSeed = vi.fn();
const logger = testLogger();
const rt = testRuntime(
  {
    catalogue: { cachedServices, cachedResources, cachedAvailability } as never,
    seed: { loadBookingSeed } as never,
  },
  { logger }
);

const STYLIST = {
  id: 'r1',
  name: 'Stylist',
  photo_url: 'https://acct.r2.cloudflarestorage.com/bucket/r1.png?sig=1',
  bio: null,
  service_ids: ['a'],
  sort_order: 1,
};

const FROM = Date.UTC(2026, 8, 1);
const TO = Date.UTC(2026, 8, 8);

beforeEach(() => {
  vi.clearAllMocks();
  cachedServices.mockResolvedValue([{ id: 'a' }]);
  cachedResources.mockResolvedValue([STYLIST]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resourcesRoute — next openings', () => {
  it('keeps the earliest start when a later one for the same stylist comes after it', async () => {
    cachedAvailability.mockResolvedValue([
      { start_ts: '2026-09-02T09:00:00.000Z', end_ts: null, resource_id: 'r1' },
      { start_ts: '2026-09-02T14:00:00.000Z', end_ts: null, resource_id: 'r1' },
    ]);

    const response = await resourcesRoute(
      rt,
      new Request(
        `https://salong.example/api/booking/resources?service_id=a&from_ts=${FROM}&to_ts=${TO}`
      )
    );

    expect((await response.json()).nextAvailableTs).toEqual({ r1: Date.UTC(2026, 8, 2, 9) });
  });

  it('logs and drops the next openings when the availability read fails', async () => {
    cachedAvailability.mockRejectedValue(new Error('down'));

    const response = await resourcesRoute(
      rt,
      new Request(
        `https://salong.example/api/booking/resources?service_id=a&from_ts=${FROM}&to_ts=${TO}`
      )
    );

    expect((await response.json()).nextAvailableTs).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'a' }),
      'Could not read next-available times for step 2'
    );
  });
});

describe('availabilityRoute — guards', () => {
  it('refuses a missing or blank bound', async () => {
    for (const query of [`service_id=a&to_ts=${TO}`, `service_id=a&from_ts=%20%20&to_ts=${TO}`]) {
      const response = await availabilityRoute(
        rt,
        new Request(`https://salong.example/api/booking/availability?${query}`)
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalidInput');
    }
    expect(cachedAvailability).not.toHaveBeenCalled();
  });

  it('relays the upstream status with the generic code when Medal names none', async () => {
    cachedAvailability.mockRejectedValue(new MedalApiError(418, undefined as never, 'teapot'));

    const response = await availabilityRoute(
      rt,
      new Request(
        `https://salong.example/api/booking/availability?service_id=a&from_ts=${FROM}&to_ts=${TO}`
      )
    );

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: 'upstreamError' });
  });
});

describe('nextFreeRoute', () => {
  it('answers no start and no label when nothing is free, still briefly cacheable', async () => {
    loadBookingSeed.mockResolvedValue({ slots: { a: [] } });

    const response = await nextFreeRoute(rt);

    expect(await response.json()).toEqual({ startTs: null, label: null });
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
  });

  it('is no-store and logged when the seed cannot be read', async () => {
    loadBookingSeed.mockRejectedValue(new Error('down'));

    const response = await nextFreeRoute(rt);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'next-free: booking seed unavailable'
    );
  });
});

describe('avatarRoute — the edges', () => {
  const upstream = vi.fn();
  const call = (headers: Record<string, string> = {}) =>
    avatarRoute(rt, new Request('https://salong.example/api/booking/avatar/r1', { headers }), 'r1');

  beforeEach(() => {
    vi.stubGlobal('fetch', upstream);
    upstream.mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
  });

  it('is 404 for a photo that is not on https, or not a URL at all', async () => {
    for (const photo_url of ['http://acct.r2.cloudflarestorage.com/r1.png', 'not a url']) {
      cachedResources.mockResolvedValue([{ ...STYLIST, photo_url }]);
      const response = await call();
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 304 for a wildcard or a weak match among several validators', async () => {
    const etag = (await call()).headers.get('ETag') ?? '';
    upstream.mockClear();

    expect((await call({ 'If-None-Match': '*' })).status).toBe(304);
    expect((await call({ 'If-None-Match': `"other", W/${etag}` })).status).toBe(304);
    expect((await call({ 'If-None-Match': '"other"' })).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('refuses a body with no content type, and an SVG, logging the non-raster one', async () => {
    upstream.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    const untyped = await call();
    expect(untyped.status).toBe(502);

    upstream.mockResolvedValueOnce(
      new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })
    );
    const svg = await call();
    expect(svg.status).toBe(502);
    expect(logger.warn).toHaveBeenCalledWith(
      { resourceId: 'r1', contentType: 'image/svg+xml' },
      'Stylist photo is not a raster image'
    );
  });

  it('is 502 for a failed upstream with no body to cancel', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 500 }));

    const response = await call();

    expect(response.status).toBe(502);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

import type { OrderingLocations } from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError } from '@medalsocial/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocationsRoute, type LocationsRouteOptions } from '../../src/next/locations-route';
import { json, KEY, LOCATIONS, SITE } from './routes-support';

type LocationsFn = (request?: { signal?: AbortSignal }) => Promise<{ data: OrderingLocations }>;

function setup(options: Partial<LocationsRouteOptions> = {}) {
  const locations = vi.fn<LocationsFn>(async () => ({ data: LOCATIONS }));
  const onError = vi.fn();
  const GET = createLocationsRoute({
    apiKey: KEY,
    medal: { ordering: { locations } },
    onError,
    ...options,
  });
  return { GET, locations, onError };
}

const req = (init: RequestInit = {}) => new Request(`${SITE}/api/ordering/locations`, init);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createLocationsRoute', () => {
  it('answers { data } with a short public Cache-Control', async () => {
    const { GET, locations } = setup();
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=15, stale-while-revalidate=30'
    );
    expect(await json(response)).toEqual({ data: LOCATIONS });
    expect(locations).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  });

  it('keeps the answer 15 s in the process, then asks Medal again', async () => {
    const { GET, locations } = setup();
    await GET(req());
    vi.advanceTimersByTime(14_999);
    await GET(req());
    expect(locations).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await GET(req());
    expect(locations).toHaveBeenCalledTimes(2);
  });

  it('shares one Medal call between concurrent visitors', async () => {
    const { GET, locations } = setup();
    let release: (value: { data: OrderingLocations }) => void = () => undefined;
    locations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const first = GET(req());
    const second = GET(req());
    await Promise.resolve();
    release({ data: LOCATIONS });
    const answers = await Promise.all([first, second]);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(locations).toHaveBeenCalledTimes(1);
  });

  it('is not tied to one visitor leaving: the shared call has its own deadline', async () => {
    const { GET, locations } = setup();
    const controller = new AbortController();
    controller.abort();
    await GET(req({ signal: controller.signal }));
    expect(locations.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
  });

  it('filters to the configured location', async () => {
    const { GET } = setup({ location: ' loc_2 ' });
    const { data } = await json<OrderingLocations>(await GET(req()));
    expect(data?.time_zone).toBe('Europe/Oslo');
    expect(data?.locations.map((l) => l.id)).toEqual(['loc_2']);
  });

  it('a configured location Medal does not list answers an empty list', async () => {
    const { GET } = setup({ location: 'loc_9' });
    const { data } = await json<OrderingLocations>(await GET(req()));
    expect(data?.locations).toEqual([]);
  });

  it.each([
    ['over 64 characters', 'x'.repeat(65)],
    ['not a string', 42 as unknown as string],
  ])(
    'a location that is set but %s is NOT_CONFIGURED, never the whole list',
    async (_n, location) => {
      const { GET, onError } = setup({ location });
      const response = await GET(req());
      expect(response.status).toBe(500);
      expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
      expect(onError).toHaveBeenCalled();
    }
  );

  it('a null location means every location', async () => {
    const { GET } = setup({ location: null as unknown as string });
    const { data } = await json<OrderingLocations>(await GET(req()));
    expect(data?.locations).toHaveLength(2);
  });

  it('a blank location means every location', async () => {
    const { GET } = setup({ location: '  ' });
    const { data } = await json<OrderingLocations>(await GET(req()));
    expect(data?.locations).toHaveLength(2);
  });

  it.each([
    [
      'no ordering',
      new MedalApiError(403, 'ORDERING_NOT_ENABLED', 'x'),
      404,
      'ORDERING_NOT_ENABLED',
    ],
    ['a Medal 404', new MedalApiError(404, 'NOT_FOUND', 'x'), 502, 'SERVICE_UNAVAILABLE'],
    ['a Medal 429', new MedalApiError(429, 'RATE_LIMITED', 'x'), 503, 'SERVICE_UNAVAILABLE'],
    ['the network', new MedalNetworkError('down'), 502, 'SERVICE_UNAVAILABLE'],
  ])('maps %s to %i %s, reports it once and caches nothing', async (_n, error, status, code) => {
    const { GET, locations, onError } = setup();
    let fail: (reason: unknown) => void = () => undefined;
    locations.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const first = GET(req());
    const second = GET(req());
    await Promise.resolve();
    fail(error);
    for (const response of await Promise.all([first, second])) {
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await json(response)).error?.code).toBe(code);
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect((await GET(req())).status).toBe(200);
    expect(locations).toHaveBeenCalledTimes(2);
  });

  it('a missing key is a 500 NOT_CONFIGURED, decided at request time', async () => {
    const onError = vi.fn();
    const GET = createLocationsRoute({ apiKey: undefined as unknown as string, onError });
    const response = await GET(req());
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

import type { OrderingSlotsOptions } from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createOrderRoute, createOrderStatusRoute } from '../../src/next/order-routes';
import { createSlotsRoute } from '../../src/next/slots-route';
import { createTableRoute } from '../../src/next/table-route';
import { CUSTOMER_ORDER, json, KEY, SITE, SLOTS, STATUS_VIEW, TABLE } from './routes-support';

type Read = { signal?: AbortSignal };

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`${SITE}${path}`, init);
}

function slotsSetup(location = 'loc_1') {
  const slots = vi.fn(async (_options: OrderingSlotsOptions, _request?: Read) => ({
    data: SLOTS,
  }));
  const onError = vi.fn();
  const GET = createSlotsRoute({ apiKey: KEY, location, medal: { ordering: { slots } }, onError });
  return { GET, slots, onError };
}

describe('createSlotsRoute', () => {
  it('answers { data } with a public 60 s Cache-Control', async () => {
    const { GET, slots } = slotsSetup();
    const response = await GET(req('/api/ordering/slots?channel=TakeAway&date=2026-10-23'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=60');
    expect(await json(response)).toEqual({ data: SLOTS });
    expect(slots).toHaveBeenCalledWith(
      { location: 'loc_1', channel: 'takeaway', date: '2026-10-23' },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('takes the location only from its options, never the request', async () => {
    const { GET, slots } = slotsSetup();
    await GET(req('/s?channel=takeaway&date=2026-10-23&location=loc_evil&location_id=loc_evil'));
    expect(slots.mock.calls[0]?.[0].location).toBe('loc_1');
  });

  it.each([
    ['no channel', '?date=2026-10-23'],
    ['an unknown channel', '?channel=drone&date=2026-10-23'],
    ['no date', '?channel=takeaway'],
    ['a date with a time', '?channel=takeaway&date=2026-10-23T10:00'],
    ['an impossible date', '?channel=takeaway&date=2026-02-30'],
    ['a garbled date', '?channel=takeaway&date=tomorrow'],
  ])('refuses %s with 400 before any Medal call', async (_name, query) => {
    const { GET, slots } = slotsSetup();
    const response = await GET(req(`/s${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(slots).not.toHaveBeenCalled();
  });

  it.each([
    ['blank', '  '],
    ['over-long', 'l'.repeat(65)],
  ])('a %s location is 500 NOT_CONFIGURED, reported', async (_name, location) => {
    const { GET, slots, onError } = slotsSetup(location);
    const response = await GET(req('/s?channel=takeaway&date=2026-10-23'));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(slots).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a location Medal does not know is 500 NOT_CONFIGURED', async () => {
    const { GET, slots } = slotsSetup();
    slots.mockRejectedValueOnce(new MedalApiError(404, 'NOT_FOUND', 'no such location'));
    const response = await GET(req('/s?channel=takeaway&date=2026-10-23'));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
  });

  it('a date outside the preorder window (Medal 400) is 400 INVALID_REQUEST', async () => {
    const { GET, slots } = slotsSetup();
    slots.mockRejectedValueOnce(new MedalApiError(400, 'VALIDATION_ERROR', 'date'));
    const response = await GET(req('/s?channel=takeaway&date=2026-12-23'));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
  });
});

function tableSetup() {
  const table = vi.fn(async (_token: string, _request?: Read) => ({ data: TABLE }));
  const onError = vi.fn();
  const GET = createTableRoute({ apiKey: KEY, medal: { ordering: { table } }, onError });
  return { GET, table, onError };
}

describe('createTableRoute', () => {
  it('answers { data } private and uncached', async () => {
    const { GET, table } = tableSetup();
    const response = await GET(req('/api/ordering/table?t=abc_12'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await json(response)).toEqual({ data: TABLE });
    expect(table).toHaveBeenCalledWith('abc_12', { signal: expect.any(AbortSignal) });
  });

  it.each([
    ['no token', ''],
    ['a blank token', '?t=%20'],
    ['a token with a slash', '?t=a%2F..'],
    ['an over-long token', `?t=${'a'.repeat(65)}`],
  ])('refuses %s with 400 before any Medal call', async (_name, query) => {
    const { GET, table } = tableSetup();
    const response = await GET(req(`/t${query}`));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(table).not.toHaveBeenCalled();
  });

  it('an unknown table is 404 TABLE_NOT_FOUND', async () => {
    const { GET, table, onError } = tableSetup();
    const error = new MedalApiError(404, 'TABLE_NOT_FOUND', 'gone');
    table.mockRejectedValueOnce(error);
    const response = await GET(req('/t?t=abc'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe('TABLE_NOT_FOUND');
    expect(onError).toHaveBeenCalledWith(error);
  });
});

type ReadById<T> = (id: string, request?: Read) => Promise<{ data: T }>;

describe.each([
  [
    'createOrderStatusRoute',
    (fn: ReadById<unknown>, onError: (e: unknown) => void) =>
      createOrderStatusRoute({
        apiKey: KEY,
        medal: { ordering: { orders: { status: fn as ReadById<typeof STATUS_VIEW> } } },
        onError,
      }),
    STATUS_VIEW,
  ],
  [
    'createOrderRoute',
    (fn: ReadById<unknown>, onError: (e: unknown) => void) =>
      createOrderRoute({
        apiKey: KEY,
        medal: { ordering: { orders: { get: fn as ReadById<typeof CUSTOMER_ORDER> } } },
        onError,
      }),
    CUSTOMER_ORDER,
  ],
])('%s', (_name, create, data) => {
  function setup() {
    const read = vi.fn<ReadById<unknown>>(async () => ({ data }));
    const onError = vi.fn();
    return { GET: create(read, onError), read, onError };
  }

  it('answers { data } uncached', async () => {
    const { GET, read } = setup();
    const response = await GET(req('/o?id=%20ord_1%20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ data });
    expect(read).toHaveBeenCalledWith('ord_1', { signal: expect.any(AbortSignal) });
  });

  it.each([
    ['no id', ''],
    ['a blank id', '?id=%20%20'],
    ['an over-long id', `?id=${'o'.repeat(65)}`],
    ['a dot segment', '?id=..'],
  ])('refuses %s with 400 before any Medal call', async (_n, query) => {
    const { GET, read } = setup();
    const response = await GET(req(`/o${query}`));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(read).not.toHaveBeenCalled();
  });

  it('takes a 64-character id', async () => {
    const { GET, read } = setup();
    const response = await GET(req(`/o?id=${'o'.repeat(64)}`));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a Medal 404', new MedalApiError(404, 'ORDER_NOT_FOUND', 'x'), 404, 'ORDER_NOT_FOUND'],
    [
      'no ordering',
      new MedalApiError(403, 'ORDERING_NOT_ENABLED', 'x'),
      404,
      'ORDERING_NOT_ENABLED',
    ],
    ['a Medal 400', new MedalApiError(400, 'VALIDATION_ERROR', 'x'), 400, 'INVALID_REQUEST'],
    ['a Medal 429', new MedalApiError(429, 'RATE_LIMITED', 'x'), 503, 'SERVICE_UNAVAILABLE'],
    ['a rejected key', new MedalApiError(401, 'UNAUTHORIZED', 'x'), 502, 'SERVICE_UNAVAILABLE'],
    ['a Medal 5xx', new MedalApiError(503, 'UNAVAILABLE', 'x'), 502, 'SERVICE_UNAVAILABLE'],
    ['the network', new MedalNetworkError('fetch failed'), 502, 'SERVICE_UNAVAILABLE'],
  ])('maps %s to %i %s and reports it', async (_n, error, status, code) => {
    const { GET, read, onError } = setup();
    read.mockRejectedValueOnce(error);
    const response = await GET(req('/o?id=ord_1'));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe(code);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('a duck-typed MedalApiError from a second SDK copy maps by status', async () => {
    const { GET, read } = setup();
    const foreign = Object.assign(new Error('x'), {
      name: 'MedalApiError',
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
    read.mockRejectedValueOnce(foreign);
    const response = await GET(req('/o?id=ord_1'));
    expect(response.status).toBe(404);
  });

  it('aborts the Medal call when the visitor leaves', async () => {
    const { GET, read } = setup();
    let seen: AbortSignal | undefined;
    read.mockImplementationOnce(async (_id, request) => {
      seen = request?.signal;
      throw new DOMException('aborted', 'AbortError');
    });
    const controller = new AbortController();
    controller.abort();
    const response = await GET(req('/o?id=ord_1', { signal: controller.signal }));
    expect(seen?.aborted).toBe(true);
    expect(response.status).toBe(502);
  });

  it('a throwing onError never breaks the response', async () => {
    const read = vi.fn<ReadById<unknown>>(async () => {
      throw new MedalNetworkError('down');
    });
    const GET = create(read, () => {
      throw new Error('logger down');
    });
    expect((await GET(req('/o?id=ord_1'))).status).toBe(502);
  });

  it('a missing key is a 500 NOT_CONFIGURED, decided at request time', async () => {
    const onError = vi.fn();
    const factory = _name === 'createOrderRoute' ? createOrderRoute : createOrderStatusRoute;
    const response = await factory({ apiKey: ' ', onError })(req('/o?id=ord_1'));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

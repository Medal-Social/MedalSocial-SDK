/** `key never in response`: across every ordering route and every error path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAddressResolveRoute,
  createAddressSuggestRoute,
  createDeliveryQuoteRoute,
  createLocationsRoute,
  createOrderRoute,
  createOrderStatusRoute,
  createPlaceOrderRoute,
  createSlotsRoute,
  createTableRoute,
  createVippsReturnRoute,
} from '../../src/next/index';
import {
  ADDRESS,
  CREATED,
  CUSTOMER_ORDER,
  expectClean,
  KEY,
  LOCATIONS,
  leakyFailures,
  ORDER,
  QUOTE,
  SITE,
  SLOTS,
  STATUS_VIEW,
  SUGGESTIONS,
  TABLE,
  UPSTREAM,
  visible,
} from './routes-support';

type Handler = (request: Request) => Promise<Response>;

/** A fake whose every method answers `data` until told to fail once. */
function fake<T>(data: T) {
  return vi.fn(async (..._args: unknown[]) => ({ data }));
}

const get = (path: string) => new Request(`${SITE}${path}`);

function postOrder(body: unknown = ORDER, headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/ordering/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'k1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface Case {
  name: string;
  handler: Handler;
  call: ReturnType<typeof fake>;
  ok: () => Request;
  refused: (() => Request)[];
  unconfigured: Handler;
}

function cases(): Case[] {
  const locations = fake(LOCATIONS);
  const slots = fake(SLOTS);
  const table = fake(TABLE);
  const create = fake(CREATED);
  const status = fake(STATUS_VIEW);
  const order = fake(CUSTOMER_ORDER);
  const vippsStatus = fake(STATUS_VIEW);
  const suggest = fake(SUGGESTIONS);
  const resolve = fake(ADDRESS);
  const quote = fake(QUOTE);
  const pick = { id: 'kv_1', session: 'sess_0123456789' };
  const priced = { address_id: 'addr_1', order_total: 25_000 };
  const paths = { receiptPath: '/order', fallbackPath: '/checkout' };
  return [
    {
      name: 'locations',
      handler: createLocationsRoute({ apiKey: KEY, medal: { ordering: { locations } } as never }),
      call: locations,
      ok: () => get('/l'),
      refused: [],
      unconfigured: createLocationsRoute({ apiKey: '' }),
    },
    {
      name: 'slots',
      handler: createSlotsRoute({
        apiKey: KEY,
        location: 'loc_1',
        medal: { ordering: { slots } } as never,
      }),
      call: slots,
      ok: () => get('/s?channel=takeaway&date=2026-10-23'),
      refused: [
        () => get(`/s?channel=${KEY}&date=2026-10-23`),
        () => get(`/s?channel=takeaway&date=${KEY}`),
      ],
      unconfigured: createSlotsRoute({ apiKey: '', location: 'loc_1' }),
    },
    {
      name: 'table',
      handler: createTableRoute({ apiKey: KEY, medal: { ordering: { table } } as never }),
      call: table,
      ok: () => get('/t?t=tbl_1'),
      refused: [() => get(`/t?t=${KEY}.`)],
      unconfigured: createTableRoute({ apiKey: '' }),
    },
    {
      name: 'place order',
      handler: createPlaceOrderRoute({
        apiKey: KEY,
        location: 'loc_1',
        returnUrl: `${SITE}/r`,
        medal: { ordering: { orders: { create } } } as never,
      }),
      call: create,
      ok: () => postOrder(),
      refused: [
        () => postOrder(ORDER, { origin: `https://${KEY}.example` }),
        () => postOrder(ORDER, { 'content-type': `text/${KEY}` }),
        () => postOrder(ORDER, { 'idempotency-key': KEY.repeat(4) }),
        () => postOrder(`{"${KEY}":`),
        () => postOrder({ ...ORDER, [KEY]: KEY }),
        () => postOrder({ ...ORDER, payment_method: KEY }),
      ],
      unconfigured: createPlaceOrderRoute({ apiKey: '', location: 'loc_1' }),
    },
    {
      name: 'order status',
      handler: createOrderStatusRoute({
        apiKey: KEY,
        medal: { ordering: { orders: { status } } } as never,
      }),
      call: status,
      ok: () => get('/o?id=ord_1'),
      refused: [() => get(`/o?id=${KEY.repeat(2)}`)],
      unconfigured: createOrderStatusRoute({ apiKey: '' }),
    },
    {
      name: 'order',
      handler: createOrderRoute({
        apiKey: KEY,
        medal: { ordering: { orders: { get: order } } } as never,
      }),
      call: order,
      ok: () => get('/o?id=ord_1'),
      refused: [() => get(`/o?id=${KEY.repeat(2)}`)],
      unconfigured: createOrderRoute({ apiKey: '' }),
    },
    {
      name: 'vipps return',
      handler: createVippsReturnRoute({
        apiKey: KEY,
        ...paths,
        medal: { ordering: { orders: { status: vippsStatus } } } as never,
      }),
      call: vippsStatus,
      ok: () => get('/v?order_id=ord_1'),
      refused: [() => get(`/v?order_id=${KEY.repeat(2)}`)],
      unconfigured: createVippsReturnRoute({ apiKey: '', ...paths }),
    },
    {
      name: 'address suggest',
      handler: createAddressSuggestRoute({
        apiKey: KEY,
        medal: { delivery: { addresses: { suggest } } } as never,
      }),
      call: suggest,
      ok: () => get('/a?q=storgata&session=sess_0123456789'),
      refused: [() => get(`/a?q=x&session=${KEY}/`), () => get(`/a?q=${KEY.repeat(6)}`)],
      unconfigured: createAddressSuggestRoute({ apiKey: '' }),
    },
    {
      name: 'address resolve',
      handler: createAddressResolveRoute({
        apiKey: KEY,
        medal: { delivery: { addresses: { resolve } } } as never,
      }),
      call: resolve,
      ok: () => postJson('/r', pick),
      refused: [
        () => postJson('/r', pick, { origin: `https://${KEY}.example` }),
        () => postJson('/r', pick, { 'content-type': `text/${KEY}` }),
        () => postJson('/r', { ...pick, [KEY]: KEY }),
        () => postJson('/r', { id: KEY.repeat(20) }),
      ],
      unconfigured: createAddressResolveRoute({ apiKey: '' }),
    },
    {
      name: 'delivery quote',
      handler: createDeliveryQuoteRoute({
        apiKey: KEY,
        maxQuotesPerMinute: 30,
        medal: { delivery: { quotes: { create: quote } } } as never,
      }),
      call: quote,
      ok: () => postJson('/q', priced),
      refused: [
        () => postJson('/q', priced, { origin: `https://${KEY}.example` }),
        () => postJson('/q', { ...priced, venue_id: KEY }),
        () => postJson('/q', { ...priced, address_id: KEY.repeat(3) }),
        () => postJson('/q', `{"${KEY}":`),
      ],
      unconfigured: createDeliveryQuoteRoute({ apiKey: '' }),
    },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ordering routes — key never in response', () => {
  it.each(cases().map((c) => [c.name, c] as const))(
    '%s: on success, every refusal and every Medal failure',
    async (_name, c) => {
      const seen: string[] = [];
      seen.push(await visible(await c.handler(c.ok())));
      for (const request of c.refused) seen.push(await visible(await c.handler(request())));
      seen.push(await visible(await c.unconfigured(c.ok())));
      for (const error of leakyFailures()) {
        c.call.mockRejectedValueOnce(error);
        // The locations route keeps a success 15 s; a new route per failure asks Medal each time.
        seen.push(await visible(await c.handler(c.ok())));
        if (c.name === 'locations') {
          const fresh = createLocationsRoute({
            apiKey: KEY,
            medal: { ordering: { locations: c.call } } as never,
          });
          c.call.mockRejectedValueOnce(error);
          seen.push(await visible(await fresh(c.ok())));
        }
      }
      expect(seen.length).toBeGreaterThan(leakyFailures().length);
      expectClean(seen);
    }
  );

  it('place order through the real SDK client: the key goes upstream only, never back out', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { customer: { name: string } };
      if (body.customer.name === 'Refused') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'SOLD_OUT',
              message: `sold out ${KEY}`,
              details: { ids: ['p_1'], key: KEY },
            },
          }),
          { status: 422, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: CREATED }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const POST = createPlaceOrderRoute({
      apiKey: KEY,
      baseUrl: UPSTREAM,
      location: 'loc_1',
      clientIp: (r) => r.headers.get('x-forwarded-for')?.split(',')[0],
    });

    const ok = await POST(postOrder(ORDER, { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
    expect(ok.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${UPSTREAM}/api/v1/ordering/orders`);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('idempotency-key')).toBe('k1');
    expect(headers.get('x-medal-client-ip')).toBe('198.51.100.7');
    expect(JSON.parse(String(init?.body))).toEqual({ ...ORDER, location_id: 'loc_1' });

    const refused = await POST(
      postOrder({ ...ORDER, customer: { name: 'Refused', phone: '+4791234567' } })
    );
    expect(refused.status).toBe(422);
    const seen = [await visible(ok), await visible(refused)];
    expect(seen[1]).toContain('"ids":["p_1"]');
    expectClean(seen);
  });
});

describe('delivery routes — key never in response', () => {
  it('a delivery refusal through the real SDK client: the key goes upstream only', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'ADDRESS_NOT_VERIFIED', message: `needs a house number ${KEY}` },
          }),
          { status: 422, headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    const POST = createAddressResolveRoute({ apiKey: KEY, baseUrl: UPSTREAM });
    const response = await POST(postJson('/r', { id: 'kv_1', session: 'sess_0123456789' }));
    expect(response.status).toBe(422);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(String(url)).toBe(`${UPSTREAM}/api/v1/delivery/addresses/resolve`);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expectClean([await visible(response)]);
  });
});

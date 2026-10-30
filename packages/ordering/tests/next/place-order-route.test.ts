import type { OrderingCreateOrderInput, OrderingCreateOrderOptions } from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError, MedalTimeoutError } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createPlaceOrderRoute,
  type PlaceOrderRouteOptions,
} from '../../src/next/place-order-route';
import { CREATED, json, KEY, ORDER, SITE } from './routes-support';

type CreateFn = (
  input: OrderingCreateOrderInput,
  options: OrderingCreateOrderOptions
) => Promise<{ data: typeof CREATED }>;

const URL_ = `${SITE}/api/ordering/orders`;
const IDEMPOTENCY_KEY = 'cart_0123456789';

function setup(options: Partial<PlaceOrderRouteOptions> = {}) {
  const create = vi.fn<CreateFn>(async () => ({ data: CREATED }));
  const onError = vi.fn();
  const POST = createPlaceOrderRoute({
    apiKey: KEY,
    location: 'loc_1',
    returnUrl: `${SITE}/order/return`,
    medal: { ordering: { orders: { create } } },
    onError,
    ...options,
  });
  return { POST, create, onError };
}

function post(
  body: unknown = ORDER,
  headers: Record<string, string> = {},
  init: RequestInit = {}
): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': IDEMPOTENCY_KEY,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

function sent(create: ReturnType<typeof setup>['create'], call = 0) {
  const [input, options] = create.mock.calls[call] ?? [];
  return { input, options };
}

/** A JSON POST whose body never finishes; abort `left` to make the visitor leave. */
function stalledPost(url: string, left: AbortController, headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":'));
    },
  });
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
    signal: left.signal,
  } as RequestInit);
}

describe('createPlaceOrderRoute — success', () => {
  it('answers 201 { data } uncached and places the order at the configured location', async () => {
    const { POST, create } = setup();
    const response = await POST(post());
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ data: CREATED });
    const { input, options } = sent(create);
    expect(input).toEqual({ ...ORDER, location_id: 'loc_1' });
    expect(options).toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
      clientIp: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps every optional field the browser may send', async () => {
    const { POST, create } = setup();
    const full = {
      channel: 'dine_in',
      timing: { kind: 'scheduled', at: '2026-10-22T18:00:00Z' },
      table_token: 'tbl_12',
      lines: [
        { product_id: 'p_1', quantity: 1 },
        { product_id: 'p_2', quantity: 3, option_ids: [], note: 'no onions' },
      ],
      customer: { name: 'Kari', phone: '+4791234567', email: 'kari@example.no' },
      preferences: { cutlery: false, allergy_note: 'nuts', no_contact: true },
      payment_method: 'pay_at_counter',
    };
    await POST(post(full));
    expect(sent(create).input).toEqual({ ...full, location_id: 'loc_1' });
  });

  it('takes preferences without cutlery, and include_allergy_note', async () => {
    const { POST, create } = setup();
    const body = { ...ORDER, preferences: { include_allergy_note: false } };
    expect((await POST(post(body))).status).toBe(201);
    expect(sent(create).input?.preferences).toEqual({ include_allergy_note: false });
    expect(
      (await POST(post({ ...ORDER, preferences: { include_allergy_note: 'no' } }))).status
    ).toBe(400);
    expect((await POST(post({ ...ORDER, preferences: { cutlery: 'yes' } }))).status).toBe(400);
  });

  it('takes an asap timing', async () => {
    const { POST, create } = setup();
    await POST(post({ ...ORDER, timing: { kind: 'asap' } }));
    expect(sent(create).input?.timing).toEqual({ kind: 'asap' });
  });

  const internal = (headers: Record<string, string>) =>
    new Request('http://internal:3000/api/ordering/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': IDEMPOTENCY_KEY,
        ...headers,
      },
      body: JSON.stringify(ORDER),
    });

  it('trusts no forwarded header by default: the Origin must be request.url’s', async () => {
    const { POST, create } = setup();
    // An attacker naming their own host in the forwarded headers and the Origin.
    const attack = await POST(
      post(ORDER, {
        origin: 'https://evil.test',
        'x-forwarded-host': 'evil.test',
        'x-forwarded-proto': 'https',
        host: 'evil.test',
      })
    );
    expect(attack.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect((await POST(post(ORDER, { origin: SITE }))).status).toBe(201);
    // Behind a proxy without `siteOrigin`, the site's own Origin is refused too.
    const site = new URL(SITE).host;
    expect((await POST(internal({ origin: SITE, 'x-forwarded-host': site }))).status).toBe(403);
  });

  it('takes the configured siteOrigin, and only that, behind a proxy', async () => {
    const { POST } = setup({ siteOrigin: [`${SITE}/`, 'http://localhost:3000'] });
    expect((await POST(internal({ origin: SITE }))).status).toBe(201);
    expect((await POST(internal({ origin: 'http://localhost:3000' }))).status).toBe(201);
    expect(
      (
        await POST(
          internal({
            origin: 'https://evil.test',
            'x-forwarded-host': 'evil.test',
            host: 'evil.test',
          })
        )
      ).status
    ).toBe(403);
  });

  it('takes the forwarded host only with trustForwardedHost', async () => {
    const { POST } = setup({ trustForwardedHost: true });
    const site = new URL(SITE).host;
    expect(
      (await POST(internal({ origin: SITE, 'x-forwarded-host': `${site}, internal` }))).status
    ).toBe(201);
    expect((await POST(internal({ origin: SITE, host: site }))).status).toBe(201);
    expect(
      (
        await POST(
          internal({
            origin: 'http://shop.test',
            'x-forwarded-host': 'shop.test',
            'x-forwarded-proto': 'http',
          })
        )
      ).status
    ).toBe(201);
    expect((await POST(internal({ origin: SITE, host: 'bad host' }))).status).toBe(403);
    expect((await POST(internal({ origin: 'https://evil.test', host: site }))).status).toBe(403);
  });

  it('answers 408 for a body that never finishes, without calling Medal', async () => {
    const { POST, create } = setup();
    const left = new AbortController();
    const answer = POST(stalledPost(URL_, left, { 'idempotency-key': IDEMPOTENCY_KEY }));
    left.abort();
    const response = await answer;
    expect(response.status).toBe(408);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a charset on the content type and a matching Origin', async () => {
    const { POST } = setup();
    const response = await POST(
      post(ORDER, { 'content-type': 'Application/JSON; charset=utf-8', origin: SITE })
    );
    expect(response.status).toBe(201);
  });

  it('trims the Idempotency-Key and takes 100 characters', async () => {
    const { POST, create } = setup();
    const key = 'k'.repeat(100);
    await POST(post(ORDER, { 'idempotency-key': ` ${key} ` }));
    expect(sent(create).options?.idempotencyKey).toBe(key);
  });
});

describe('createPlaceOrderRoute — idempotency key stable on retry', () => {
  it('two POSTs with the same Idempotency-Key and body reach the SDK with the same key', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(new MedalNetworkError('lost'));
    expect((await POST(post())).status).toBe(502);
    expect((await POST(post())).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
    expect(sent(create, 0).options?.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(sent(create, 1).options?.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(sent(create, 0).input).toEqual(sent(create, 1).input);
  });
});

describe('createPlaceOrderRoute — Vipps', () => {
  const vipps = { ...ORDER, payment_method: 'vipps' };

  it('sets return_url from options', async () => {
    const { POST, create } = setup();
    await POST(post(vipps));
    expect(sent(create).input).toEqual({
      ...vipps,
      location_id: 'loc_1',
      return_url: `${SITE}/order/return`,
    });
  });

  it('takes return_url from a function of the request', async () => {
    const returnUrl = vi.fn((request: Request) => `${new URL(request.url).origin}/r`);
    const { POST, create } = setup({ returnUrl });
    await POST(post(vipps));
    expect(sent(create).input?.return_url).toBe(`${SITE}/r`);
    expect(returnUrl).toHaveBeenCalledTimes(1);
  });

  it('never sends return_url with pay_at_counter', async () => {
    const { POST, create } = setup();
    await POST(post());
    expect(sent(create).input).not.toHaveProperty('return_url');
  });

  it.each([
    ['none', undefined],
    ['a relative path', '/order/return'],
    ['a non-http URL', 'javascript:alert(1)'],
    ['a function answering garbage', () => 'not a url'],
    ['a function answering a non-string', () => 42 as unknown as string],
    [
      'a throwing function',
      () => {
        throw new Error('no host');
      },
    ],
  ])('with %s configured is 500 NOT_CONFIGURED, reported', async (_n, returnUrl) => {
    const { POST, create, onError } = setup({ returnUrl });
    const response = await POST(post(vipps));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(create).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('pay_at_counter needs no returnUrl', async () => {
    const { POST } = setup({ returnUrl: undefined });
    expect((await POST(post())).status).toBe(201);
  });
});

describe('createPlaceOrderRoute — delivery', () => {
  const DELIVERY = {
    verified_address_id: 'addr_1',
    quote_id: 'q_1',
    floor: '3',
    door_code: '1234',
    comment: 'Ring twice',
  };
  const order = {
    ...ORDER,
    channel: 'delivery',
    payment_method: 'vipps',
    preferences: { cutlery: true, no_contact: true },
    delivery: DELIVERY,
  };

  it('forwards the address, quote and door details with the return page', async () => {
    const { POST, create } = setup();
    const response = await POST(post(order));
    expect(response.status).toBe(201);
    expect(sent(create).input).toEqual({
      ...order,
      location_id: 'loc_1',
      return_url: `${SITE}/order/return`,
    });
  });

  it('takes every delivery field at the API’s limits, untrimmed', async () => {
    const { POST, create } = setup();
    const delivery = {
      verified_address_id: 'a'.repeat(64),
      quote_id: 'q'.repeat(64),
      floor: 'x'.repeat(20),
      door_code: 'x'.repeat(20),
      comment: 'x'.repeat(500),
    };
    expect((await POST(post({ ...order, delivery }))).status).toBe(201);
    expect(sent(create).input?.delivery).toEqual(delivery);
  });

  it('takes the address and quote alone', async () => {
    const { POST, create } = setup();
    const delivery = { verified_address_id: 'addr_1', quote_id: 'q_1' };
    await POST(post({ ...order, delivery }));
    expect(sent(create).input?.delivery).toEqual(delivery);
  });

  it('needs the Vipps return page', async () => {
    const { POST, create } = setup({ returnUrl: undefined });
    expect((await POST(post(order))).status).toBe(500);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['paid at the counter', { ...order, payment_method: 'pay_at_counter' }],
    ['without delivery', { ...order, delivery: undefined }],
    ['with delivery that is not an object', { ...order, delivery: 'addr_1' }],
    ['with a fee', { ...order, delivery: { ...DELIVERY, fee_ore: 0 } }],
    ['with a venue', { ...order, delivery: { ...DELIVERY, venue_id: 'v_1' } }],
    ['without the address', { ...order, delivery: { quote_id: 'q_1' } }],
    ['without the quote', { ...order, delivery: { verified_address_id: 'addr_1' } }],
    ['with a numeric quote', { ...order, delivery: { ...DELIVERY, quote_id: 1 } }],
    ['with a numeric floor', { ...order, delivery: { ...DELIVERY, floor: 3 } }],
    ['with a numeric door code', { ...order, delivery: { ...DELIVERY, door_code: 1234 } }],
    ['with a null comment', { ...order, delivery: { ...DELIVERY, comment: null } }],
    ['with an empty address id', { ...order, delivery: { ...DELIVERY, verified_address_id: '' } }],
    [
      'with an address id over 64 characters',
      { ...order, delivery: { ...DELIVERY, verified_address_id: 'a'.repeat(65) } },
    ],
    ['with an empty quote id', { ...order, delivery: { ...DELIVERY, quote_id: '' } }],
    [
      'with a quote id over 64 characters',
      { ...order, delivery: { ...DELIVERY, quote_id: 'q'.repeat(65) } },
    ],
    [
      'with a floor over 20 characters',
      { ...order, delivery: { ...DELIVERY, floor: 'x'.repeat(21) } },
    ],
    [
      'with a door code over 20 characters',
      { ...order, delivery: { ...DELIVERY, door_code: 'x'.repeat(21) } },
    ],
    [
      'with a comment over 500 characters',
      { ...order, delivery: { ...DELIVERY, comment: 'x'.repeat(501) } },
    ],
    ['for pickup', { ...ORDER, payment_method: 'vipps', delivery: DELIVERY }],
  ])('refuses a delivery %s with 400 before any Medal call', async (_n, body) => {
    const { POST, create } = setup();
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['QUOTE_EXPIRED', 'QUOTE_NOT_USABLE'])(
    'passes a %s refusal through for the checkout to ask again',
    async (code) => {
      const { POST, create } = setup();
      create.mockRejectedValueOnce(new MedalApiError(422, code, 'x'));
      const response = await POST(post(order));
      expect(response.status).toBe(422);
      expect((await json(response)).error?.code).toBe(code);
    }
  );

  it('passes a refused door detail through with its reason', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(
      new MedalApiError(422, 'INVALID_CUSTOMER', 'x', { reason: 'door_code' })
    );
    const response = await POST(post(order));
    expect((await json(response)).error).toMatchObject({
      code: 'INVALID_CUSTOMER',
      details: { reason: 'door_code' },
    });
  });
});

describe('createPlaceOrderRoute — location and return_url never come from the request', () => {
  it.each([
    ['location_id', { location_id: 'loc_evil' }],
    ['return_url', { return_url: 'https://evil.example/' }],
    ['location', { location: 'loc_evil' }],
  ])('a body with %s is 400 INVALID_REQUEST', async (_n, extra) => {
    const { POST, create } = setup();
    const response = await POST(post({ ...ORDER, payment_method: 'vipps', ...extra }));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores location and return_url in the query', async () => {
    const { POST, create } = setup();
    const request = new Request(`${URL_}?location=loc_evil&return_url=https://evil.example/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
      body: JSON.stringify({ ...ORDER, payment_method: 'vipps' }),
    });
    await POST(request);
    expect(sent(create).input).toMatchObject({
      location_id: 'loc_1',
      return_url: `${SITE}/order/return`,
    });
  });
});

describe('createPlaceOrderRoute — CSRF and content type', () => {
  it.each([
    ['another site', 'https://evil.example'],
    ['another port', 'https://site.example.test:8443'],
    ['http instead of https', 'http://site.example.test'],
    ['an opaque origin', 'null'],
  ])('refuses an Origin of %s with 403, before reading the body', async (_n, origin) => {
    const { POST, create } = setup();
    const response = await POST(post(ORDER, { origin }));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['no content type', undefined],
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['json-ish', 'application/jsonp'],
  ])('refuses %s with 415', async (_n, type) => {
    const { POST, create } = setup();
    const request = new Request(URL_, {
      method: 'POST',
      headers: type
        ? { 'content-type': type, 'idempotency-key': IDEMPOTENCY_KEY }
        : { 'idempotency-key': IDEMPOTENCY_KEY },
      body: type ? JSON.stringify(ORDER) : null,
    });
    const response = await POST(request);
    expect(response.status).toBe(415);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['over 100 characters', 'k'.repeat(101)],
  ])('an Idempotency-Key that is %s is 400', async (_n, key) => {
    const { POST, create } = setup();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await POST(
      new Request(URL_, { method: 'POST', headers, body: JSON.stringify(ORDER) })
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('createPlaceOrderRoute — body limits', () => {
  it('refuses a declared Content-Length over 32 KB with 413 without reading', async () => {
    const { POST, create } = setup();
    const response = await POST(post(ORDER, { 'content-length': String(32 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a streamed body over 32 KB with 413', async () => {
    const { POST, create } = setup();
    const chunk = new TextEncoder().encode('x'.repeat(8 * 1024));
    let sentChunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sentChunks += 1;
        controller.enqueue(chunk);
        if (sentChunks > 10) controller.close();
      },
    });
    const request = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(create).not.toHaveBeenCalled();
    expect(sentChunks).toBeLessThan(10);
  });

  it('takes a body of exactly 32 KB as far as the JSON parser', async () => {
    const { POST } = setup();
    const padded = JSON.stringify({ ...ORDER, pad: '' });
    const body = padded.replace('"pad":""', `"pad":"${'x'.repeat(32 * 1024 - padded.length)}"`);
    expect(new TextEncoder().encode(body).length).toBe(32 * 1024);
    const response = await POST(post(body));
    // Within the limit, so refused by the strict shape (unknown `pad`), not by size.
    expect(response.status).toBe(400);
  });

  it('a non-numeric Content-Length falls back to counting the bytes', async () => {
    const { POST } = setup();
    const request = post(ORDER);
    const headers = new Headers(request.headers);
    headers.set('content-length', 'lots');
    const response = await POST(
      new Request(URL_, { method: 'POST', headers, body: JSON.stringify(ORDER) })
    );
    expect(response.status).toBe(201);
  });

  it('a body that is not UTF-8 is 400', async () => {
    const { POST } = setup();
    const response = await POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
        body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      })
    );
    expect(response.status).toBe(400);
  });

  it('a body stream that fails is 400', async () => {
    const { POST } = setup();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const response = await POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
        body: stream,
        duplex: 'half',
      } as RequestInit)
    );
    expect(response.status).toBe(400);
  });

  it('no body at all is 400', async () => {
    const { POST } = setup();
    const response = await POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
      })
    );
    expect(response.status).toBe(400);
  });
});

describe('createPlaceOrderRoute — strict body', () => {
  const line = ORDER.lines[0];
  it.each([
    ['not JSON', '{"channel":'],
    ['an array', [ORDER]],
    ['null', null],
    ['an unknown top-level key', { ...ORDER, coupon: 'FREE' }],
    ['a total', { ...ORDER, total_ore: 0 }],
    ['an unknown channel', { ...ORDER, channel: 'drone' }],
    ['delivery without an address and a quote', { ...ORDER, channel: 'delivery' }],
    ['a channel in another case', { ...ORDER, channel: 'Takeaway' }],
    ['an unknown payment method', { ...ORDER, payment_method: 'cash' }],
    ['a null optional field', { ...ORDER, timing: null }],
    ['a timing that is not an object', { ...ORDER, timing: 'asap' }],
    ['an unknown timing kind', { ...ORDER, timing: { kind: 'later' } }],
    ['asap with an instant', { ...ORDER, timing: { kind: 'asap', at: 'x' } }],
    ['scheduled without an instant', { ...ORDER, timing: { kind: 'scheduled' } }],
    ['a timing with an extra key', { ...ORDER, timing: { kind: 'asap', fee: 1 } }],
    ['a non-string table token', { ...ORDER, table_token: 12 }],
    ['lines that are not a list', { ...ORDER, lines: {} }],
    ['a line that is not an object', { ...ORDER, lines: ['p_1'] }],
    ['a line price', { ...ORDER, lines: [{ ...line, price_ore: 0 }] }],
    ['a unit price', { ...ORDER, lines: [{ ...line, unit_price_ore: 0 }] }],
    ['a line without product', { ...ORDER, lines: [{ quantity: 1 }] }],
    ['a string quantity', { ...ORDER, lines: [{ product_id: 'p', quantity: '2' }] }],
    ['option ids not a list', { ...ORDER, lines: [{ ...line, option_ids: 'o_1' }] }],
    ['a non-string option id', { ...ORDER, lines: [{ ...line, option_ids: [1] }] }],
    ['a non-string note', { ...ORDER, lines: [{ ...line, note: 1 }] }],
    ['no customer', { ...ORDER, customer: undefined }],
    ['a customer with an extra key', { ...ORDER, customer: { ...ORDER.customer, vip: true } }],
    ['a customer without phone', { ...ORDER, customer: { name: 'Kari' } }],
    ['a customer name that is not text', { ...ORDER, customer: { name: 1, phone: '1' } }],
    ['a non-string e-mail', { ...ORDER, customer: { ...ORDER.customer, email: 1 } }],
    ['no preferences', { ...ORDER, preferences: undefined }],
    ['preferences with an extra key', { ...ORDER, preferences: { cutlery: true, tip: 50 } }],
    ['a non-boolean cutlery', { ...ORDER, preferences: { cutlery: 'yes' } }],
    ['a non-string allergy note', { ...ORDER, preferences: { cutlery: true, allergy_note: 1 } }],
    ['a non-boolean no_contact', { ...ORDER, preferences: { cutlery: true, no_contact: 1 } }],
  ])('refuses %s with 400 INVALID_REQUEST before any Medal call', async (_n, body) => {
    const { POST, create } = setup();
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('a __proto__ key is refused, not merged', async () => {
    const { POST, create } = setup();
    const body = `{"__proto__":{"location_id":"loc_evil"},${JSON.stringify(ORDER).slice(1)}`;
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('createPlaceOrderRoute — client IP', () => {
  async function ipFor(headers: Record<string, string>, options = {}) {
    const { POST, create } = setup(options);
    await POST(post(ORDER, headers));
    return sent(create).options?.clientIp;
  }

  it('trusts no header by default: a guest could forge any of them', async () => {
    expect(
      await ipFor({
        'cf-connecting-ip': '203.0.113.1',
        'x-forwarded-for': '198.51.100.1',
        'x-real-ip': '192.0.2.1',
      })
    ).toBeUndefined();
  });

  it('takes the IP from options.clientIp', async () => {
    const clientIp = vi.fn(() => ' 2001:db8::1 ');
    expect(await ipFor({ 'cf-connecting-ip': '203.0.113.1' }, { clientIp })).toBe('2001:db8::1');
    expect(clientIp).toHaveBeenCalledWith(expect.any(Request));
  });

  it('options.clientIp answering nothing sends none (headers are not trusted then)', async () => {
    expect(
      await ipFor({ 'cf-connecting-ip': '203.0.113.1' }, { clientIp: () => undefined })
    ).toBeUndefined();
  });

  it('a throwing options.clientIp sends none and is reported', async () => {
    const { POST, create, onError } = setup({
      clientIp: () => {
        throw new Error('no ip');
      },
    });
    expect((await POST(post())).status).toBe(201);
    expect(sent(create).options?.clientIp).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('createPlaceOrderRoute — Medal failures', () => {
  it.each([
    ['SOLD_OUT', { ids: ['p_1', 'o_1'] }, { ids: ['p_1', 'o_1'] }],
    ['INVALID_OPTIONS', { line_index: 0, status: 'x' }, { line_index: 0 }],
    ['INVALID_CUSTOMER', { reason: 'phone', extra: 'secret' }, { reason: 'phone' }],
    ['CLOSED', { reason: 'closed', ids: 'nope', line_index: -1 }, { reason: 'closed' }],
    ['INVALID_CART', { line_index: 1.5, ids: ['a', 2] }, undefined],
    ['CUTOFF', undefined, undefined],
    ['QUOTE_EXPIRED', undefined, undefined],
    ['SAVED_ADDRESS_NOT_FOUND', undefined, undefined],
    ['TABLE_NOT_FOUND', 'not an object', undefined],
    ['PAYMENT_UNAVAILABLE', ['ids'], undefined],
  ])(
    'a 422 %s refusal passes through with only ids/line_index/reason',
    async (code, details, expected) => {
      const { POST, create, onError } = setup();
      const error = new MedalApiError(422, code, `Medal's own words for ${code}`, details);
      create.mockRejectedValueOnce(error);
      const response = await POST(post());
      expect(response.status).toBe(422);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await json(response);
      expect(body.error?.code).toBe(code);
      expect(body.error?.message).not.toContain("Medal's own words");
      expect(body.error?.details).toEqual(expected);
      expect(onError).toHaveBeenCalledWith(error);
    }
  );

  it.each([
    ['in progress', 409, 'IDEMPOTENCY_IN_PROGRESS', 409, 'IDEMPOTENCY_IN_PROGRESS'],
    ['key conflict', 409, 'IDEMPOTENCY_KEY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
    ['conflict', 409, 'IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
    ['another 409', 409, 'INVALID_TRANSITION', 502, 'SERVICE_UNAVAILABLE'],
    ['unknown location', 404, 'ORDERING_LOCATION_NOT_FOUND', 500, 'NOT_CONFIGURED'],
    ['no ordering', 403, 'ORDERING_NOT_ENABLED', 404, 'ORDERING_NOT_ENABLED'],
    ['a validation error', 400, 'VALIDATION_ERROR', 400, 'INVALID_REQUEST'],
    ['a 422 that is no refusal', 422, 'SOMETHING_NEW', 502, 'SERVICE_UNAVAILABLE'],
    ['a rejected key', 401, 'UNAUTHORIZED', 502, 'SERVICE_UNAVAILABLE'],
    ['a 5xx', 503, 'UNAVAILABLE', 502, 'SERVICE_UNAVAILABLE'],
  ])('maps %s to %i', async (_n, status, code, answer, answerCode) => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(new MedalApiError(status, code, 'x'));
    const response = await POST(post());
    expect(response.status).toBe(answer);
    expect((await json(response)).error?.code).toBe(answerCode);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('a 429 is 429 RATE_LIMITED with Retry-After in whole seconds', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(
      new MedalApiError(429, 'RATE_LIMITED', 'x', undefined, { retryAfterMs: 1_500 })
    );
    const response = await POST(post());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect((await json(response)).error?.code).toBe('RATE_LIMITED');
  });

  it('a 429 without a retry hint has no Retry-After', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(new MedalApiError(429, 'RATE_LIMITED', 'x'));
    const response = await POST(post());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('a duck-typed refusal from a second SDK copy passes through', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        name: 'MedalApiError',
        status: 422,
        code: 'SOLD_OUT',
        details: { ids: ['p_1'] },
        retryAfterMs: null,
      })
    );
    const response = await POST(post());
    expect(response.status).toBe(422);
    expect((await json(response)).error).toMatchObject({
      code: 'SOLD_OUT',
      details: { ids: ['p_1'] },
    });
  });

  it.each([
    ['the network', new MedalNetworkError('down')],
    ['a timeout', new MedalTimeoutError(5_000)],
    ['an unknown throw', new Error('boom')],
  ])('%s is 502 SERVICE_UNAVAILABLE', async (_n, error) => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(error);
    const response = await POST(post());
    expect(response.status).toBe(502);
    expect((await json(response)).error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('gives the call one signal that aborts with the visitor', async () => {
    const { POST, create } = setup();
    create.mockImplementationOnce(
      (_input, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        })
    );
    const controller = new AbortController();
    const request = post(ORDER, {}, { signal: controller.signal });
    const pending = POST(request);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent(create).options?.signal?.aborted).toBe(false);
    controller.abort();
    const response = await pending;
    expect(request.signal.aborted).toBe(true);
    expect(response.status).toBe(502);
  });

  it('places the order once: no retry of its own', async () => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(new MedalApiError(503, 'UNAVAILABLE', 'x'));
    await POST(post());
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('createPlaceOrderRoute — configuration', () => {
  it.each([
    ['no key', { apiKey: '' }],
    ['no location', { location: ' ' }],
    ['an over-long location', { location: 'l'.repeat(65) }],
  ])('%s is 500 NOT_CONFIGURED, reported', async (_n, options) => {
    const onError = vi.fn();
    const POST = createPlaceOrderRoute({ apiKey: KEY, location: 'loc_1', onError, ...options });
    const response = await POST(post());
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a throwing onError never breaks the response', async () => {
    const { POST, create } = setup({
      onError: () => {
        throw new Error('logger down');
      },
    });
    create.mockRejectedValueOnce(new MedalNetworkError('down'));
    expect((await POST(post())).status).toBe(502);
  });
});

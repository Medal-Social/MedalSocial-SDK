import type {
  DeliveryAddressOptions,
  DeliveryQuoteInput,
  DeliveryQuoteOptions,
} from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError, MedalTimeoutError } from '@medalsocial/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAddressResolveRoute,
  createAddressSuggestRoute,
  createDeliveryQuoteRoute,
  type DeliveryQuoteRouteOptions,
} from '../../src/next/delivery-routes';
import { ADDRESS, json, KEY, QUOTE, SITE, SUGGESTIONS, UPSTREAM } from './routes-support';

const SESSION = 'sess_0123456789';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Every delivery failure Medal answers, and what the browser gets for it. */
const FAILURES: [string, number, string, number, string][] = [
  ['an unverified address', 422, 'ADDRESS_NOT_VERIFIED', 422, 'ADDRESS_NOT_VERIFIED'],
  ['a place Wolt cannot reach now', 422, 'NOT_DELIVERABLE', 422, 'ADDRESS_NOT_DELIVERABLE'],
  ['an address Wolt refuses', 422, 'ADDRESS_NOT_DELIVERABLE', 422, 'ADDRESS_NOT_DELIVERABLE'],
  ['delivery not set up', 409, 'DELIVERY_NOT_SET_UP', 409, 'DELIVERY_UNAVAILABLE'],
  ['delivery paused', 409, 'DELIVERY_PAUSED', 409, 'DELIVERY_UNAVAILABLE'],
  ['the venue unavailable', 409, 'VENUE_UNAVAILABLE', 409, 'DELIVERY_UNAVAILABLE'],
  ['a slow quote', 504, 'QUOTE_TIMEOUT', 504, 'QUOTE_TIMEOUT'],
  ['the register down', 503, 'ADDRESS_LOOKUP_UNAVAILABLE', 502, 'SERVICE_UNAVAILABLE'],
  ['the site’s key over its limit', 429, 'RATE_LIMITED', 503, 'SERVICE_UNAVAILABLE'],
  ['a refused request', 400, 'VALIDATION_ERROR', 400, 'INVALID_REQUEST'],
  ['no ordering', 403, 'ORDERING_NOT_ENABLED', 404, 'ORDERING_NOT_ENABLED'],
  ['a rejected key', 401, 'UNAUTHORIZED', 502, 'SERVICE_UNAVAILABLE'],
  ['a 5xx', 500, 'INTERNAL', 502, 'SERVICE_UNAVAILABLE'],
];

describe('createAddressSuggestRoute', () => {
  function setup() {
    const suggest = vi.fn(async (_q: string, _o?: DeliveryAddressOptions) => ({
      data: SUGGESTIONS,
    }));
    const onError = vi.fn();
    const GET = createAddressSuggestRoute({
      apiKey: KEY,
      medal: { delivery: { addresses: { suggest } } },
      onError,
    });
    return { GET, suggest, onError };
  }
  const get = (query: string) => new Request(`${SITE}/api/ordering/address?${query}`);

  it('answers the suggestions for q and session, never cached', async () => {
    const { GET, suggest } = setup();
    const response = await GET(get(`q=storgata%201&session=${SESSION}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ data: SUGGESTIONS });
    expect(suggest).toHaveBeenCalledWith('storgata 1', {
      session: SESSION,
      signal: expect.any(AbortSignal),
    });
  });

  it('takes a lookup without a session, and a blank one as none', async () => {
    const { GET, suggest } = setup();
    await GET(get('q=st'));
    await GET(get('q=st&session='));
    expect(suggest.mock.calls.map((c) => c[1]?.session)).toEqual([undefined, undefined]);
  });

  it.each([
    ['no q', 'session=sess_0123456789'],
    ['a q over 200 characters', `q=${'x'.repeat(201)}`],
    ['a short session', 'q=storgata&session=abc'],
    ['a session with other characters', 'q=storgata&session=sess%2F0123456789'],
    ['a session over 64 characters', `q=storgata&session=${'s'.repeat(65)}`],
  ])('refuses %s with 400 before any Medal call', async (_n, query) => {
    const { GET, suggest } = setup();
    const response = await GET(get(query));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(suggest).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('maps %s', async (_n, status, code, answer, answerCode) => {
    const { GET, suggest, onError } = setup();
    const error = new MedalApiError(status, code, `Medal's words ${KEY}`);
    suggest.mockRejectedValueOnce(error);
    const response = await GET(get('q=storgata'));
    expect(response.status).toBe(answer);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.error?.code).toBe(answerCode);
    expect(body.error?.message).not.toContain('Medal');
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('a missing key is 500 NOT_CONFIGURED', async () => {
    const response = await createAddressSuggestRoute({ apiKey: '' })(get('q=storgata'));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
  });
});

describe('createAddressResolveRoute', () => {
  function setup() {
    const resolve = vi.fn(async (_id: string, _o?: DeliveryAddressOptions) => ({ data: ADDRESS }));
    const onError = vi.fn();
    const POST = createAddressResolveRoute({
      apiKey: KEY,
      medal: { delivery: { addresses: { resolve } } },
      onError,
    });
    return { POST, resolve, onError };
  }
  const PATH = '/api/ordering/address/resolve';

  it('answers the verified address, never cached', async () => {
    const { POST, resolve } = setup();
    const response = await POST(post(PATH, { id: 'kv_1', session: SESSION }, { origin: SITE }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ data: ADDRESS });
    expect(resolve).toHaveBeenCalledWith('kv_1', {
      session: SESSION,
      signal: expect.any(AbortSignal),
    });
  });

  it('takes an id without a session', async () => {
    const { POST, resolve } = setup();
    await POST(post(PATH, { id: 'kv_1' }));
    expect(resolve.mock.calls[0]?.[1]?.session).toBeUndefined();
  });

  it('refuses another site with 403 and anything but JSON with 415', async () => {
    const { POST, resolve } = setup();
    const cross = await POST(post(PATH, { id: 'kv_1' }, { origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    const text = await POST(post(PATH, { id: 'kv_1' }, { 'content-type': 'text/plain' }));
    expect(text.status).toBe(415);
    expect((await json(text)).error?.code).toBe('INVALID_REQUEST');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a body over 4 KB with 413', async () => {
    const { POST, resolve } = setup();
    const response = await POST(post(PATH, { id: 'x'.repeat(5000) }));
    expect(response.status).toBe(413);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', '{"id":'],
    ['not UTF-8', new Uint8Array([0x7b, 0xff, 0x7d])],
    ['an array', ['kv_1']],
    ['no id', { session: SESSION }],
    ['a blank id', { id: '  ' }],
    ['a numeric id', { id: 1 }],
    ['an id over 320 characters', { id: 'x'.repeat(321) }],
    ['a malformed session', { id: 'kv_1', session: 'abc' }],
    ['a numeric session', { id: 'kv_1', session: 12345678 }],
    ['an unknown key', { id: 'kv_1', location: 'loc_evil' }],
  ])('refuses %s with 400 before any Medal call', async (_n, body) => {
    const { POST, resolve } = setup();
    const request =
      body instanceof Uint8Array
        ? new Request(`${SITE}${PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        : post(PATH, body);
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('maps %s', async (_n, status, code, answer, answerCode) => {
    const { POST, resolve } = setup();
    resolve.mockRejectedValueOnce(new MedalApiError(status, code, KEY));
    const response = await POST(post(PATH, { id: 'kv_1' }));
    expect(response.status).toBe(answer);
    expect((await json(response)).error?.code).toBe(answerCode);
  });

  it.each([
    ['the network', new MedalNetworkError('down')],
    ['a timeout', new MedalTimeoutError(5_000)],
    ['an unknown throw', new Error('boom')],
  ])('%s is 502 SERVICE_UNAVAILABLE', async (_n, error) => {
    const { POST, resolve } = setup();
    resolve.mockRejectedValueOnce(error);
    const response = await POST(post(PATH, { id: 'kv_1' }));
    expect(response.status).toBe(502);
    expect((await json(response)).error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('a missing key is 500 NOT_CONFIGURED, reported', async () => {
    const onError = vi.fn();
    const response = await createAddressResolveRoute({ apiKey: ' ', onError })(
      post(PATH, { id: 'kv_1' })
    );
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('createDeliveryQuoteRoute', () => {
  type CreateFn = (
    input: DeliveryQuoteInput,
    options?: DeliveryQuoteOptions
  ) => Promise<{ data: typeof QUOTE }>;

  function setup(options: Partial<DeliveryQuoteRouteOptions> = {}) {
    const create = vi.fn<CreateFn>(async () => ({ data: QUOTE }));
    const onError = vi.fn();
    const POST = createDeliveryQuoteRoute({
      apiKey: KEY,
      medal: { delivery: { quotes: { create } } },
      onError,
      ...options,
    });
    return { POST, create, onError };
  }
  /** The client IP as Cloudflare sets it. */
  const cfIp = (request: Request) => request.headers.get('cf-connecting-ip');
  const from = (ip: string) => post(PATH, BODY, { 'cf-connecting-ip': ip });
  const PATH = '/api/ordering/delivery-quote';
  const BODY = { address_id: 'addr_1', order_total: 25_000 };

  it('answers 201 with the quote, never cached, for the address and the subtotal only', async () => {
    const { POST, create } = setup();
    const response = await POST(post(PATH, BODY, { origin: SITE }));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ data: QUOTE });
    expect(create).toHaveBeenCalledWith(BODY, { signal: expect.any(AbortSignal) });
  });

  it.each([
    ['a venue', { ...BODY, venue_id: 'v_evil' }],
    ['bags', { ...BODY, bags: 20 }],
    ['prep minutes', { ...BODY, prep_minutes: 0 }],
    ['no address', { order_total: 25_000 }],
    ['no total', { address_id: 'addr_1' }],
    ['a blank address', { ...BODY, address_id: ' ' }],
    ['an address over 64 characters', { ...BODY, address_id: 'a'.repeat(65) }],
    ['a numeric address', { ...BODY, address_id: 1 }],
    ['a total in kroner', { ...BODY, order_total: 250.5 }],
    ['a total as text', { ...BODY, order_total: '25000' }],
    ['a negative total', { ...BODY, order_total: -1 }],
    ['a total over the API’s cap', { ...BODY, order_total: 100_000_001 }],
    ['null', null],
  ])('refuses a body with %s with 400 before any Medal call', async (_n, body) => {
    const { POST, create } = setup();
    const response = await POST(post(PATH, body));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it('takes a total of 0 and of the API’s cap', async () => {
    const { POST } = setup();
    expect((await POST(post(PATH, { ...BODY, order_total: 0 }))).status).toBe(201);
    expect((await POST(post(PATH, { ...BODY, order_total: 100_000_000 }))).status).toBe(201);
  });

  it('refuses another site, a form and a large body', async () => {
    const { POST, create } = setup();
    expect((await POST(post(PATH, BODY, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(post(PATH, BODY, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post(PATH, { ...BODY, pad: 'x'.repeat(5000) }))).status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('maps %s', async (_n, status, code, answer, answerCode) => {
    const { POST, create } = setup();
    create.mockRejectedValueOnce(new MedalApiError(status, code, KEY));
    const response = await POST(post(PATH, BODY));
    expect(response.status).toBe(answer);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe(answerCode);
  });

  it('spends at most maxQuotesPerMinute Medal calls a minute, then 503 without a call', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-29T17:00:00Z'), toFake: ['Date'] });
    const { POST, create } = setup({ maxQuotesPerMinute: 2 });
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    create.mockRejectedValueOnce(new MedalApiError(504, 'QUOTE_TIMEOUT', 'x'));
    expect((await POST(post(PATH, BODY))).status).toBe(504);
    const spent = await POST(post(PATH, BODY));
    expect(spent.status).toBe(503);
    expect(spent.headers.get('cache-control')).toBe('no-store');
    expect((await json(spent)).error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(create).toHaveBeenCalledTimes(2);
    // A refused body costs nothing.
    expect((await POST(post(PATH, { address_id: 'addr_1' }))).status).toBe(400);
    vi.setSystemTime(Date.parse('2026-10-29T17:01:00Z'));
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('defaults to 20 quotes a minute, and 0 turns quotes off', async () => {
    const { POST, create } = setup();
    for (let i = 0; i < 20; i += 1) await POST(post(PATH, BODY));
    expect((await POST(post(PATH, BODY))).status).toBe(503);
    expect(create).toHaveBeenCalledTimes(20);
    const off = setup({ maxQuotesPerMinute: 0 });
    expect((await off.POST(post(PATH, BODY))).status).toBe(503);
    expect(off.create).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN, 31])('refuses maxQuotesPerMinute %s at setup', (max) => {
    expect(() => createDeliveryQuoteRoute({ apiKey: KEY, maxQuotesPerMinute: max })).toThrow(
      RangeError
    );
  });

  it('takes up to the key’s 30 quotes a minute', () => {
    expect(() => createDeliveryQuoteRoute({ apiKey: KEY, maxQuotesPerMinute: 30 })).not.toThrow();
  });

  it('spends at most maxQuotesPerClientPerMinute for one IP, before the shared budget', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-29T17:00:00Z'), toFake: ['Date'] });
    const { POST, create } = setup({
      clientIp: cfIp,
      maxQuotesPerMinute: 3,
      maxQuotesPerClientPerMinute: 2,
    });
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
    const spent = await POST(from('203.0.113.1'));
    expect(spent.status).toBe(503);
    expect((await json(spent)).error?.code).toBe('SERVICE_UNAVAILABLE');
    // The refused one took nothing from the shared budget: another visitor gets its last quote.
    expect((await POST(from('198.51.100.7'))).status).toBe(201);
    expect((await POST(from('198.51.100.8'))).status).toBe(503);
    expect(create).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.parse('2026-10-29T17:01:00Z'));
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
  });

  it('gives each IP 5 quotes a minute by default, and without an IP only the shared budget', async () => {
    const { POST, create } = setup({ clientIp: cfIp });
    for (let i = 0; i < 5; i += 1) expect((await POST(from('203.0.113.1'))).status).toBe(201);
    expect((await POST(from('203.0.113.1'))).status).toBe(503);
    // No IP (the header not set, or blank): only the route's 20 a minute apply.
    for (let i = 0; i < 6; i += 1) expect((await POST(post(PATH, BODY))).status).toBe(201);
    expect((await POST(from('  '))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(12);
  });

  it('a throwing clientIp counts as no IP and is reported', async () => {
    const boom = new Error('no header');
    const { POST, create, onError } = setup({
      clientIp: () => {
        throw boom;
      },
      maxQuotesPerClientPerMinute: 1,
    });
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('keeps at most 1,000 IPs, dropping the oldest window first', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-29T17:00:00Z'), toFake: ['Date'] });
    const crowd = async (count: number) => {
      for (let i = 0; i < count; i += 1) await POST(from(`10.0.${i >> 8}.${i & 255}`));
    };
    let { POST } = setup({
      clientIp: cfIp,
      maxQuotesPerMinute: 30,
      maxQuotesPerClientPerMinute: 1,
    });
    // The shared window starts now; the guest's own one 59 s later.
    await POST(from('192.0.2.1'));
    vi.setSystemTime(Date.parse('2026-10-29T17:00:59Z'));
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
    await crowd(999);
    // A minute after the shared window opened it is new again; the guest's own is not.
    vi.setSystemTime(Date.parse('2026-10-29T17:01:00Z'));
    expect((await POST(from('203.0.113.1'))).status).toBe(503);

    vi.setSystemTime(Date.parse('2026-10-29T17:00:00Z'));
    ({ POST } = setup({ clientIp: cfIp, maxQuotesPerMinute: 30, maxQuotesPerClientPerMinute: 1 }));
    await POST(from('192.0.2.1'));
    vi.setSystemTime(Date.parse('2026-10-29T17:00:59Z'));
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
    // One IP more than the map holds: the two oldest windows are dropped, the guest's among them.
    await crowd(1_000);
    vi.setSystemTime(Date.parse('2026-10-29T17:01:00Z'));
    expect((await POST(from('203.0.113.1'))).status).toBe(201);
  });

  it.each([0, -1, 1.5, 21])('refuses maxQuotesPerClientPerMinute %s at setup', (max) => {
    expect(() =>
      createDeliveryQuoteRoute({ apiKey: KEY, maxQuotesPerClientPerMinute: max })
    ).toThrow(RangeError);
  });

  it('refuses a per-client limit over the route’s, and checks none with quotes off', () => {
    expect(() =>
      createDeliveryQuoteRoute({
        apiKey: KEY,
        maxQuotesPerMinute: 3,
        maxQuotesPerClientPerMinute: 4,
      })
    ).toThrow(RangeError);
    expect(() =>
      createDeliveryQuoteRoute({
        apiKey: KEY,
        maxQuotesPerMinute: 3,
        maxQuotesPerClientPerMinute: 3,
      })
    ).not.toThrow();
    expect(() => createDeliveryQuoteRoute({ apiKey: KEY, maxQuotesPerMinute: 0 })).not.toThrow();
  });

  it('asks allowQuote after its own checks, and answers 503 without a call when it says no', async () => {
    const allowQuote = vi.fn(async (_request: Request) => false);
    const { POST, create } = setup({ allowQuote });
    const request = post(PATH, BODY);
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect((await json(response)).error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(allowQuote).toHaveBeenCalledExactlyOnceWith(request);
    expect(create).not.toHaveBeenCalled();
    // A body refused, or a budget spent here, never reaches the shared limiter.
    await POST(post(PATH, { address_id: 'addr_1' }));
    const off = setup({ allowQuote, maxQuotesPerMinute: 0 });
    await off.POST(post(PATH, BODY));
    expect(allowQuote).toHaveBeenCalledOnce();
  });

  it('calls Medal when allowQuote says yes, at once or later', async () => {
    const { POST, create } = setup({ allowQuote: () => true });
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    const later = setup({ allowQuote: async () => true });
    expect((await later.POST(post(PATH, BODY))).status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(later.create).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('kv down');
      },
    ],
    ['rejects', async () => Promise.reject(new Error('kv down'))],
  ])('a limiter that %s lets the quote through, reported', async (_n, allowQuote) => {
    const { POST, create, onError } = setup({ allowQuote });
    expect((await POST(post(PATH, BODY))).status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(new Error('kv down'));
  });

  it('a limiter slower than 1.5 s lets the quote through, reported', async () => {
    vi.useFakeTimers();
    const { POST, create, onError } = setup({ allowQuote: () => new Promise<boolean>(() => {}) });
    const pending = POST(post(PATH, BODY));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('gives Medal 25 s, one attempt, aborting with the visitor', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { POST, create } = setup();
    create.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        })
    );
    const controller = new AbortController();
    const request = new Request(`${SITE}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
      signal: controller.signal,
    });
    const pending = POST(request);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(timeout).toHaveBeenCalledWith(25_000);
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('answers its own 25 s deadline with 504 QUOTE_TIMEOUT', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const { POST, create, onError } = setup();
    create.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        })
    );
    const pending = POST(post(PATH, BODY));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    const response = await pending;
    expect(response.status).toBe(504);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error?.code).toBe('QUOTE_TIMEOUT');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('builds its client with a 25 s attempt, sent once', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'QUOTE_TIMEOUT', message: KEY } }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const POST = createDeliveryQuoteRoute({ apiKey: KEY, baseUrl: UPSTREAM });
    const response = await POST(post(PATH, BODY));
    expect(response.status).toBe(504);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls.some(([, ms]) => ms === 25_000)).toBe(true);
  });

  it('a missing key is 500 NOT_CONFIGURED and spends nothing', async () => {
    const onError = vi.fn();
    const response = await createDeliveryQuoteRoute({ apiKey: '', onError })(post(PATH, BODY));
    expect(response.status).toBe(500);
    expect((await json(response)).error?.code).toBe('NOT_CONFIGURED');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

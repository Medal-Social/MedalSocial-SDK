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

  function setup(maxQuotesPerMinute?: number) {
    const create = vi.fn<CreateFn>(async () => ({ data: QUOTE }));
    const onError = vi.fn();
    const POST = createDeliveryQuoteRoute({
      apiKey: KEY,
      medal: { delivery: { quotes: { create } } },
      onError,
      maxQuotesPerMinute,
    });
    return { POST, create, onError };
  }
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
    const { POST, create } = setup(2);
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
    const off = setup(0);
    expect((await off.POST(post(PATH, BODY))).status).toBe(503);
    expect(off.create).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN])('refuses maxQuotesPerMinute %s at setup', (max) => {
    expect(() => createDeliveryQuoteRoute({ apiKey: KEY, maxQuotesPerMinute: max })).toThrow(
      RangeError
    );
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaceOrderRequest } from '../../src/core/checkout';
import {
  fetchAddressSuggestions,
  fetchOrderStatus,
  placeOrder,
  requestDeliveryQuote,
  resolveAddress,
} from '../../src/core/client';

const REQUEST: PlaceOrderRequest = {
  channel: 'takeaway',
  lines: [{ product_id: 'water', quantity: 1, option_ids: [] }],
  customer: { name: 'Kari', phone: '91234567' },
  preferences: { cutlery: true },
  payment_method: 'pay_at_counter',
};

function answer(status: number, body: unknown) {
  return vi.fn(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('placeOrder', () => {
  it('posts JSON with the idempotency key and resolves the created order', async () => {
    const fetch = answer(201, { data: { order_id: 'o1', order_number: 'P-1', status: 'placed' } });
    vi.stubGlobal('fetch', fetch);
    const result = await placeOrder({
      url: '/api/ordering/orders',
      request: REQUEST,
      idempotencyKey: 'k1',
    });
    expect(result).toEqual({
      ok: true,
      data: { order_id: 'o1', order_number: 'P-1', status: 'placed' },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ordering/orders');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'idempotency-key': 'k1' });
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves the route error as it came', async () => {
    const error = { code: 'SOLD_OUT', message: 'Sold out.', details: { ids: ['a'] } };
    vi.stubGlobal('fetch', answer(422, { error }));
    expect(await placeOrder({ url: '/o', request: REQUEST, idempotencyKey: 'k' })).toEqual({
      ok: false,
      error,
    });
  });

  it.each([
    ['a network failure', vi.fn(async () => Promise.reject(new TypeError('offline')))],
    ['an answer that is not JSON', answer(502, '<html>')],
    ['an error that is not the routes shape', answer(500, { error: 'boom' })],
    ['a 200 without data', answer(200, { nothing: true })],
    ['a JSON null', answer(200, 'null')],
    ['an error body on a 200', answer(200, { error: { code: 'X', message: 'y' } })],
  ])('reads %s as SERVICE_UNAVAILABLE', async (_name, fetch) => {
    vi.stubGlobal('fetch', fetch);
    const result = await placeOrder({ url: '/o', request: REQUEST, idempotencyKey: 'k' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: expect.any(String) },
    });
  });

  it('rejects when the caller aborts', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw init.signal?.reason ?? new Error('aborted');
      })
    );
    await expect(
      placeOrder({ url: '/o', request: REQUEST, idempotencyKey: 'k', signal: controller.signal })
    ).rejects.toBeDefined();
  });
});

describe('fetchOrderStatus', () => {
  it('reads the status route with the id, no-store', async () => {
    const fetch = answer(200, { data: { order_id: 'o 1', status: 'ready' } });
    vi.stubGlobal('fetch', fetch);
    const result = await fetchOrderStatus('/api/ordering/status', 'o 1');
    expect(result).toEqual({ ok: true, data: { order_id: 'o 1', status: 'ready' } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ordering/status?id=o%201');
    expect(init.cache).toBe('no-store');
  });

  it('adds the id to a route that already has a query', async () => {
    const fetch = answer(404, { error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const result = await fetchOrderStatus('/s?site=a', 'o1', signal);
    expect(result).toEqual({
      ok: false,
      error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' },
    });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('/s?site=a&id=o1');
  });
});

describe('the delivery helpers', () => {
  it('fetchAddressSuggestions reads the suggest route with q and session, no-store', async () => {
    const suggestions = [{ id: 'kv_1', label: 'Storgata 1', secondary: '0155 Oslo' }];
    const fetch = answer(200, { data: suggestions });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(
      await fetchAddressSuggestions(
        '/api/ordering/address',
        { q: 'storgata 1&x', session: 's_12345678' },
        signal
      )
    ).toEqual({ ok: true, data: suggestions });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ordering/address?q=storgata%201%26x&session=s_12345678');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store' });
    await fetchAddressSuggestions('/a?site=b', { q: 'x', session: 's' });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toBe('/a?site=b&q=x&session=s');
  });

  it('resolveAddress posts the id and session as JSON', async () => {
    const error = { code: 'ADDRESS_NOT_VERIFIED', message: 'Not verified.' };
    const fetch = answer(422, { error });
    vi.stubGlobal('fetch', fetch);
    expect(await resolveAddress('/r', { id: 'kv_1', session: 's_12345678' })).toEqual({
      ok: false,
      error,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/r');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ id: 'kv_1', session: 's_12345678' });
  });

  it('requestDeliveryQuote posts the address and the subtotal, and waits out the route', async () => {
    const quote = { quote_id: 'q_1' };
    const fetch = answer(201, { data: quote });
    vi.stubGlobal('fetch', fetch);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect(await requestDeliveryQuote('/q', { address_id: 'a_1', order_total: 25_000 })).toEqual({
      ok: true,
      data: quote,
    });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ address_id: 'a_1', order_total: 25_000 });
    // The route gives Medal 25 s; the browser waits longer than that.
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
  });
});

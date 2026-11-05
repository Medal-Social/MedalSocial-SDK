import type { OrderingOrderStatusView } from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createVippsReturnRoute,
  type VippsReturnRouteOptions,
} from '../../src/next/vipps-return-route';
import { KEY, SITE, STATUS_VIEW } from './routes-support';

type StatusFn = (
  id: string,
  request?: { signal?: AbortSignal }
) => Promise<{ data: OrderingOrderStatusView }>;

function setup(options: Partial<VippsReturnRouteOptions> = {}) {
  const status = vi.fn<StatusFn>(async () => ({ data: STATUS_VIEW }));
  const onError = vi.fn();
  const GET = createVippsReturnRoute({
    apiKey: KEY,
    receiptPath: '/order',
    fallbackPath: '/checkout?vipps=failed',
    medal: { ordering: { orders: { status } } },
    onError,
    ...options,
  });
  return { GET, status, onError };
}

const req = (query: string) => new Request(`${SITE}/api/ordering/vipps-return${query}`);

function expectRedirect(response: Response, to: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(to);
  expect(response.headers.get('cache-control')).toBe('no-store');
}

describe('createVippsReturnRoute — options', () => {
  it.each([
    ['receiptPath', { receiptPath: 'order' }],
    ['receiptPath', { receiptPath: '//evil.example/order' }],
    ['receiptPath', { receiptPath: '/\\evil.example' }],
    ['receiptPath', { receiptPath: 'https://evil.example/order' }],
    ['receiptPath', { receiptPath: '/order?x=1' }],
    ['receiptPath', { receiptPath: '/order#top' }],
    ['receiptPath', { receiptPath: '/or der' }],
    ['fallbackPath', { fallbackPath: '' }],
    ['fallbackPath', { fallbackPath: '//evil.example' }],
    ['fallbackPath', { fallbackPath: undefined as unknown as string }],
  ])('refuses a %s that is not a same-origin path at once', (_n, options) => {
    expect(() =>
      createVippsReturnRoute({
        apiKey: KEY,
        receiptPath: '/order',
        fallbackPath: '/checkout',
        ...options,
      })
    ).toThrow(RangeError);
  });
});

describe('createVippsReturnRoute', () => {
  it('redirects a known order to its receipt, 303 and uncached', async () => {
    const { GET, status } = setup();
    const response = await GET(req('?order_id=ord_1'));
    expectRedirect(response, `/order/ord_1`);
    expect(status).toHaveBeenCalledWith('ord_1', { signal: expect.any(AbortSignal) });
  });

  it('encodes the id into the receipt path', async () => {
    const { GET } = setup();
    const response = await GET(req('?order_id=a%2F..%2F%3Fb'));
    expectRedirect(response, `/order/a%2F..%2F%3Fb`);
  });

  it('joins a receipt path with a trailing slash once', async () => {
    const { GET } = setup({ receiptPath: '/kvittering/' });
    expectRedirect(await GET(req('?order_id=ord_1')), `/kvittering/ord_1`);
  });

  it('takes the root as the receipt path', async () => {
    const { GET } = setup({ receiptPath: '/' });
    expectRedirect(await GET(req('?order_id=ord_1')), `/ord_1`);
  });

  it.each([
    ['no id', ''],
    ['a blank id', '?order_id=%20'],
    ['an over-long id', `?order_id=${'o'.repeat(65)}`],
    ['a dot segment', '?order_id=..'],
  ])('sends %s to the fallback without a Medal call', async (_n, query) => {
    const { GET, status } = setup();
    expectRedirect(await GET(req(query)), `/checkout?vipps=failed`);
    expect(status).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown order', new MedalApiError(404, 'ORDER_NOT_FOUND', 'x')],
    ['no ordering', new MedalApiError(403, 'ORDERING_NOT_ENABLED', 'x')],
    ['a rejected key', new MedalApiError(401, 'UNAUTHORIZED', 'x')],
  ])('sends %s to the fallback, reported', async (_n, error) => {
    const { GET, status, onError } = setup();
    status.mockRejectedValueOnce(error);
    expectRedirect(await GET(req('?order_id=ord_1')), `/checkout?vipps=failed`);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it.each([
    ['a Medal 5xx', new MedalApiError(503, 'UNAVAILABLE', 'x')],
    ['a Medal 429', new MedalApiError(429, 'RATE_LIMITED', 'x')],
    ['the network', new MedalNetworkError('down')],
  ])('still sends the guest to the receipt on %s (the receipt polls)', async (_n, error) => {
    const { GET, status, onError } = setup();
    status.mockRejectedValueOnce(error);
    expectRedirect(await GET(req('?order_id=ord_1')), `/order/ord_1`);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('never redirects off the site, whatever the query says', async () => {
    const { GET } = setup();
    const response = await GET(req('?order_id=ord_1&return=https://evil.example/&next=//evil'));
    expect(response.headers.get('location')).toBe('/order/ord_1');
  });

  it('answers a relative Location, so an internal request.url never reaches the guest', async () => {
    const { GET } = setup();
    const response = await GET(
      new Request('http://localhost:3000/api/ordering/vipps-return?order_id=ord_1', {
        headers: { 'x-forwarded-host': new URL(SITE).host },
      })
    );
    expectRedirect(response, '/order/ord_1');
  });

  it('a missing key sends the guest to the fallback, reported', async () => {
    const onError = vi.fn();
    const GET = createVippsReturnRoute({
      apiKey: '',
      receiptPath: '/order',
      fallbackPath: '/checkout',
      onError,
    });
    expectRedirect(await GET(req('?order_id=ord_1')), `/checkout`);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

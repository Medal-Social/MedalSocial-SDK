/**
 * The order routes: a guest's order for the receipt page, and its status to
 * poll, read through the site so the API key stays on the server.
 *
 * ```ts
 * // app/api/ordering/order/route.ts
 * export const GET = createOrderRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * // app/api/ordering/order/status/route.ts
 * export const GET = createOrderStatusRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * ```
 *
 * `GET ?id=<order id>` answers `{ data }`, never cached. The id is the
 * guest's capability (it is long and random): Medal answers only for this
 * workspace's orders, and an unknown id is `404 ORDER_NOT_FOUND`. A missing,
 * blank or over-long id is `400 INVALID_REQUEST` without a Medal call.
 */

import type { OrderingCustomerOrder, OrderingOrderStatusView } from '@medalsocial/sdk';
import { invalidRequest, type RouteBaseOptions, readOrderId, readRoute } from './shared';

type ReadOptions = { signal?: AbortSignal };

/** The slice of the SDK client the status route uses — what a test injects. */
export interface OrderStatusClient {
  ordering: {
    orders: {
      status(orderId: string, request?: ReadOptions): Promise<{ data: OrderingOrderStatusView }>;
    };
  };
}

/** The slice of the SDK client the order route uses — what a test injects. */
export interface OrderClient {
  ordering: {
    orders: {
      get(orderId: string, request?: ReadOptions): Promise<{ data: OrderingCustomerOrder }>;
    };
  };
}

export type OrderStatusRouteOptions = RouteBaseOptions<OrderStatusClient>;
export type OrderRouteOptions = RouteBaseOptions<OrderClient>;

const ORDER_NOT_FOUND = { status: 404, code: 'ORDER_NOT_FOUND', message: 'No such order.' };

function parseId(
  request: Request
): { args: string } | { error: ReturnType<typeof invalidRequest> } {
  const id = readOrderId(new URL(request.url).searchParams.get('id'));
  return id === null ? { error: invalidRequest('id must be an order id.') } : { args: id };
}

/** A Next App Router `GET` handler serving `{ data: OrderingOrderStatusView }`. */
export function createOrderStatusRoute(
  options: OrderStatusRouteOptions
): (request: Request) => Promise<Response> {
  return readRoute(options, {
    parse: parseId,
    call: (api, id, signal) => api.ordering.orders.status(id, { signal }),
    notFound: ORDER_NOT_FOUND,
    cacheControl: 'no-store',
  });
}

/** A Next App Router `GET` handler serving `{ data: OrderingCustomerOrder }`. */
export function createOrderRoute(
  options: OrderRouteOptions
): (request: Request) => Promise<Response> {
  return readRoute(options, {
    parse: parseId,
    call: (api, id, signal) => api.ordering.orders.get(id, { signal }),
    notFound: ORDER_NOT_FOUND,
    cacheControl: 'no-store',
  });
}

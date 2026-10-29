/**
 * The browser's side of the site's ordering routes: place an order and read
 * its status through the site's own server (`@medalsocial/ordering/next`),
 * which holds the API key. Plain `fetch`, so it runs in any browser or test.
 *
 * Neither function throws for an answer the routes give: an error comes back
 * as `{ ok: false, error }` with the route's code, and a network failure, a
 * timeout or an answer that is not the routes' shape as `SERVICE_UNAVAILABLE`.
 * An abort through the caller's own `signal` still rejects, as `fetch` does.
 */
import type { OrderingOrderCreated, OrderingOrderStatusView } from '@medalsocial/sdk';
import type { OrderingRouteError, PlaceOrderRequest } from './checkout';

export type RouteResult<T> = { ok: true; data: T } | { ok: false; error: OrderingRouteError };

/** The whole round trip; the place route itself gives up on Medal well before this. */
const TIMEOUT_MS = 20_000;

const UNAVAILABLE: OrderingRouteError = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'The ordering service could not be reached.',
};

function isRouteError(value: unknown): value is OrderingRouteError {
  if (typeof value !== 'object' || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return typeof code === 'string' && typeof message === 'string';
}

async function call<T>(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<RouteResult<T>> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, error: UNAVAILABLE };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
  const envelope = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  if (response.ok && envelope.data !== undefined) return { ok: true, data: envelope.data as T };
  if (!response.ok && isRouteError(envelope.error)) return { ok: false, error: envelope.error };
  return { ok: false, error: UNAVAILABLE };
}

export interface PlaceOrderOptions {
  /** The site's place-order route, e.g. `/api/ordering/orders`. */
  url: string;
  request: PlaceOrderRequest;
  /** The cart draft's key (`draft.idempotencyKey`), sent as `Idempotency-Key`. */
  idempotencyKey: string;
  signal?: AbortSignal;
}

/**
 * Post the order. Send the SAME key for a retry of the same cart (the draft
 * store keeps it until the cart changes), so a lost answer never places the
 * order twice.
 */
export function placeOrder(options: PlaceOrderOptions): Promise<RouteResult<OrderingOrderCreated>> {
  return call<OrderingOrderCreated>(
    options.url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': options.idempotencyKey },
      body: JSON.stringify(options.request),
    },
    options.signal
  );
}

/** Read an order's status from the site's status route (`?id=` is added). */
export function fetchOrderStatus(
  url: string,
  orderId: string,
  signal?: AbortSignal
): Promise<RouteResult<OrderingOrderStatusView>> {
  const separator = url.includes('?') ? '&' : '?';
  return call<OrderingOrderStatusView>(
    `${url}${separator}id=${encodeURIComponent(orderId)}`,
    { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' },
    signal
  );
}

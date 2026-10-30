/**
 * The browser's side of the site's ordering routes: place an order and read
 * its status, and for delivery look up an address and ask for a price,
 * through the site's own server (`@medalsocial/ordering/next`), which holds
 * the API key. Plain `fetch`, so it runs in any browser or test.
 *
 * No function throws for an answer the routes give: an error comes back
 * as `{ ok: false, error }` with the route's code, and a network failure, a
 * timeout or an answer that is not the routes' shape as `SERVICE_UNAVAILABLE`.
 * An abort through the caller's own `signal` still rejects, as `fetch` does.
 */
import type {
  DeliveryAddressSuggestion,
  DeliveryQuote,
  DeliveryResolvedAddress,
  OrderingOrderCreated,
  OrderingOrderStatusView,
} from '@medalsocial/sdk';
import type { OrderingRouteError, PlaceOrderRequest } from './checkout';

export type RouteResult<T> = { ok: true; data: T } | { ok: false; error: OrderingRouteError };

/** The whole round trip; the place route itself gives up on Medal well before this. */
const TIMEOUT_MS = 20_000;

/** A quote's round trip: the quote route gives Wolt, through Medal, up to 25 s. */
const QUOTE_TIMEOUT_MS = 30_000;

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
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): Promise<RouteResult<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
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

/**
 * `url` with `query` added after its own, before any `#fragment`. Works on
 * a relative URL (`/api/ordering/status`), so no URL object.
 */
function withQuery(url: string, query: Record<string, string>): string {
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);
  const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
  const pairs = Object.entries(query).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  );
  return `${base}${separator}${pairs.join('&')}${fragment}`;
}

const GET: RequestInit = {
  method: 'GET',
  headers: { accept: 'application/json' },
  cache: 'no-store',
};

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Read an order's status from the site's status route (`?id=` is added). */
export function fetchOrderStatus(
  url: string,
  orderId: string,
  signal?: AbortSignal
): Promise<RouteResult<OrderingOrderStatusView>> {
  return call<OrderingOrderStatusView>(withQuery(url, { id: orderId }), GET, signal);
}

/** One address lookup: what the guest typed and the lookup's session (`newLookupSession`). */
export interface AddressQuery {
  q: string;
  session: string;
}

/**
 * Up to 8 addresses for what the guest typed, from the site's suggest route
 * (`?q=&session=` are added). Pass a `signal` to drop a lookup the next
 * keystroke has replaced.
 */
export function fetchAddressSuggestions(
  url: string,
  query: AddressQuery,
  signal?: AbortSignal
): Promise<RouteResult<DeliveryAddressSuggestion[]>> {
  return call<DeliveryAddressSuggestion[]>(withQuery(url, { ...query }), GET, signal);
}

/**
 * The verified address behind the suggestion the guest picked, from the
 * site's resolve route, with the same `session` as the suggestions.
 * `ADDRESS_NOT_VERIFIED` asks the guest for a house number.
 */
export function resolveAddress(
  url: string,
  pick: { id: string; session?: string },
  signal?: AbortSignal
): Promise<RouteResult<DeliveryResolvedAddress>> {
  return call<DeliveryResolvedAddress>(url, postJson(pick), signal);
}

/**
 * A delivery price for a resolved address from the site's quote route.
 * `order_total` is the cart's subtotal in øre — the order is refused when it
 * is not. A quote takes up to about 25 s.
 */
export function requestDeliveryQuote(
  url: string,
  input: { address_id: string; order_total: number },
  signal?: AbortSignal
): Promise<RouteResult<DeliveryQuote>> {
  return call<DeliveryQuote>(url, postJson(input), signal, QUOTE_TIMEOUT_MS);
}

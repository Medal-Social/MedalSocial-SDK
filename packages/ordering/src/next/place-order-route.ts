/**
 * The place-order route: the `POST` the checkout sends the guest's order to,
 * so the API key stays on the server and the browser never chooses the
 * location, the Vipps return page or a price.
 *
 * ```ts
 * // app/api/ordering/orders/route.ts
 * export const POST = createPlaceOrderRoute({
 *   apiKey: process.env.MEDAL_API_KEY!,
 *   location: process.env.MEDAL_ORDERING_LOCATION!,
 *   returnUrl: 'https://example.no/api/ordering/vipps-return',
 * });
 * ```
 *
 * The request, checked in this order before any Medal call:
 *
 * - `Origin`, when sent, must be this route's own origin (`403`): a page on
 *   another site cannot place orders with the visitor's browser.
 * - `Content-Type: application/json` (`415`) — which a cross-site form
 *   cannot send without a CORS preflight.
 * - `Idempotency-Key`: 1–100 characters, from the cart draft (`400`). It
 *   goes to Medal unchanged, so a retry of the same cart replays the first
 *   answer instead of placing a second order.
 * - A body of at most 32 KB (`413`) that is exactly a `PlaceOrderRequest`
 *   (`400`): an unknown key anywhere — a price, `location_id`, `return_url` —
 *   is refused, not dropped. A delivery must be Vipps and carry `delivery`
 *   (the address and quote ids of 1–64 characters, and floor and door code
 *   of up to 20 and the courier note of up to 500, as text); no other
 *   channel may.
 *
 * The route adds `location_id` from `location` and, for Vipps (so every
 * delivery), `return_url`
 * from `returnUrl`, then calls Medal once (the SDK retries 429/5xx with the
 * same key) within 15 s or until the guest leaves. `201 { data }` on
 * success. Medal's refusals pass through as `422` with their code and only
 * `ids`, `line_index` and `reason` from `details`; every other failure is a
 * fixed-word code (see `OrderingRouteErrorCode`).
 */

import type {
  OrderingCreateOrderInput,
  OrderingCreateOrderOptions,
  OrderingDeliveryInput,
  OrderingOrderCreated,
  OrderingOrderLineInput,
  OrderingOrderTiming,
  OrderingPaymentMethod,
  OrderingRefusalCode,
} from '@medalsocial/sdk';
import type { OrderingRouteErrorCode, PlaceOrderRequest } from '../core/checkout';
import {
  apiFailure,
  configuredLocation,
  dataResponse,
  deadline,
  type ErrorBody,
  errorResponse,
  isRecord,
  isString,
  type Json,
  lazyClient,
  NOT_CONFIGURED,
  only,
  optional,
  postGuard,
  type RouteBaseOptions,
  readBody,
  readClientIp,
  reporter,
} from './shared';

/** The slice of the SDK client the route uses — what a test injects. */
export interface PlaceOrderClient {
  ordering: {
    orders: {
      create(
        input: OrderingCreateOrderInput,
        options: OrderingCreateOrderOptions
      ): Promise<{ data: OrderingOrderCreated }>;
    };
  };
}

export interface PlaceOrderRouteOptions extends RouteBaseOptions<PlaceOrderClient> {
  /**
   * The ordering location every order goes to
   * (`process.env.MEDAL_ORDERING_LOCATION`). Never taken from the request.
   * Checked per request: unset answers `500 NOT_CONFIGURED`.
   */
  location: string;
  /**
   * Where Vipps sends the guest back — an absolute `http(s)` URL on one of
   * the workspace's sites, usually the `createVippsReturnRoute` route; Medal
   * adds `order_id`. A function gets the request (to build it from the
   * host). Without one, a Vipps order answers `500 NOT_CONFIGURED`.
   */
  returnUrl?: string | ((request: Request) => string);
  /**
   * The guest's IP address, for Medal's per-IP order limit (10 a minute per
   * site and IP). Read it from what your platform guarantees — on Cloudflare
   * `(r) => r.headers.get('cf-connecting-ip')`, which Cloudflare sets and
   * overwrites; behind your own proxy, the entry that proxy appends. No
   * header is trusted by default: a guest can send any of them, and a forged
   * one would move their orders into another visitor's bucket. Without it no
   * IP is sent, and Medal limits by the site's key alone.
   */
  clientIp?: (request: Request) => string | null | undefined;
}

/** The body cap: a full cart is a few KB. */
const MAX_BODY_BYTES = 32 * 1024;

/** The cap on the `Idempotency-Key` the browser sends. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** The whole Medal call, the SDK's retries included. */
const PLACE_DEADLINE_MS = 15_000;

/** The API's caps on a delivery, counted untrimmed (the checkout trims). */
const MAX_DELIVERY_ID_LENGTH = 64;
const MAX_FLOOR_LENGTH = 20;
const MAX_DOOR_CODE_LENGTH = 20;
const MAX_DELIVERY_COMMENT_LENGTH = 500;

const CHANNELS: readonly PlaceOrderRequest['channel'][] = ['dine_in', 'takeaway', 'delivery'];
const PAYMENT_METHODS: readonly OrderingPaymentMethod[] = ['pay_at_counter', 'vipps'];

/** Keyed by the SDK's own list, so a refusal code it adds fails the typecheck here until it passes through. */
const REFUSAL: Readonly<Record<OrderingRefusalCode, true>> = {
  CLOSED: true,
  CUTOFF: true,
  CHANNEL_NOT_AVAILABLE: true,
  PREORDER_DISABLED: true,
  SLOT_TAKEN: true,
  TABLE_NOT_FOUND: true,
  SOLD_OUT: true,
  UNAVAILABLE: true,
  INVALID_OPTIONS: true,
  INVALID_CART: true,
  PAYMENT_METHOD_NOT_ALLOWED: true,
  PAYMENT_UNAVAILABLE: true,
  RETURN_URL_NOT_ALLOWED: true,
  INVALID_CUSTOMER: true,
  QUOTE_NOT_USABLE: true,
  QUOTE_EXPIRED: true,
  SAVED_ADDRESS_NOT_FOUND: true,
};
const REFUSAL_CODES: ReadonlySet<string> = new Set(Object.keys(REFUSAL));

function failure(status: number, code: OrderingRouteErrorCode, message: string): ErrorBody {
  return { status, code, message };
}

const CROSS_ORIGIN = failure(403, 'INVALID_REQUEST', 'Orders are placed from this site only.');
const NOT_JSON = failure(415, 'INVALID_REQUEST', 'The order must be sent as application/json.');
const NO_KEY = failure(400, 'INVALID_REQUEST', 'Idempotency-Key must be 1-100 characters.');
const TOO_LARGE = failure(413, 'INVALID_REQUEST', 'The order is too large.');
const BAD_BODY = failure(400, 'INVALID_REQUEST', 'The order is not one this site takes.');
const UNAVAILABLE = failure(502, 'SERVICE_UNAVAILABLE', 'Orders cannot be placed right now.');

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
/** Text of at most `max` characters (at least one when `min` is 1). */
const text =
  (max: number, min = 0) =>
  (value: unknown): value is string =>
    isString(value) && value.length >= min && value.length <= max;
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

/** Copy the keys that are set, so the order Medal gets has no `undefined` in it. */
function defined<T extends Json>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function parseTiming(value: unknown): OrderingOrderTiming | null {
  if (!only(value, ['kind', 'at'])) return null;
  if (value.kind === 'asap' && value.at === undefined) return { kind: 'asap' };
  if (value.kind === 'scheduled' && isString(value.at)) return { kind: 'scheduled', at: value.at };
  return null;
}

function parseLine(value: unknown): OrderingOrderLineInput | null {
  if (!only(value, ['product_id', 'quantity', 'option_ids', 'note'])) return null;
  const { product_id, quantity, option_ids, note } = value;
  if (!isString(product_id) || typeof quantity !== 'number') return null;
  if (!optional(option_ids, isStrings) || !optional(note, isString)) return null;
  return defined({
    product_id,
    quantity,
    option_ids: option_ids as string[] | undefined,
    note: note as string | undefined,
  });
}

/** A delivery's address, quote and door details: exactly these keys, text within the caps. */
function parseDelivery(value: unknown): OrderingDeliveryInput | null {
  if (!only(value, ['verified_address_id', 'quote_id', 'floor', 'door_code', 'comment'])) {
    return null;
  }
  const { verified_address_id, quote_id, floor, door_code, comment } = value;
  const isId = text(MAX_DELIVERY_ID_LENGTH, 1);
  if (!isId(verified_address_id) || !isId(quote_id)) return null;
  if (!optional(floor, text(MAX_FLOOR_LENGTH))) return null;
  if (!optional(door_code, text(MAX_DOOR_CODE_LENGTH))) return null;
  if (!optional(comment, text(MAX_DELIVERY_COMMENT_LENGTH))) return null;
  return defined({
    verified_address_id,
    quote_id,
    floor: floor as string | undefined,
    door_code: door_code as string | undefined,
    comment: comment as string | undefined,
  });
}

/**
 * The browser's body as a `PlaceOrderRequest`, rebuilt from the keys it may
 * have, or `null`. Strict, as Medal is: anything else anywhere is refused.
 * Values Medal checks itself (quantities, the guest's details) are only
 * type-checked here.
 */
function parsePlaceOrder(value: unknown): PlaceOrderRequest | null {
  if (
    !only(value, [
      'channel',
      'timing',
      'table_token',
      'lines',
      'customer',
      'preferences',
      'payment_method',
      'delivery',
    ])
  ) {
    return null;
  }
  const channel = CHANNELS.find((c) => c === value.channel);
  const payment = PAYMENT_METHODS.find((m) => m === value.payment_method);
  if (!channel || !payment) return null;

  const timing = value.timing === undefined ? undefined : parseTiming(value.timing);
  if (timing === null || !optional(value.table_token, isString)) return null;

  if (!Array.isArray(value.lines)) return null;
  const lines = value.lines.map(parseLine);
  if (lines.includes(null)) return null;

  const { customer, preferences } = value;
  if (!only(customer, ['name', 'phone', 'email'])) return null;
  if (!isString(customer.name) || !isString(customer.phone)) return null;
  if (!optional(customer.email, isString)) return null;

  if (!only(preferences, ['allergy_note', 'cutlery', 'no_contact', 'include_allergy_note'])) {
    return null;
  }
  if (!optional(preferences.allergy_note, isString)) return null;
  if (!optional(preferences.cutlery, isBoolean) || !optional(preferences.no_contact, isBoolean)) {
    return null;
  }
  if (!optional(preferences.include_allergy_note, isBoolean)) return null;

  const base = defined({
    timing,
    table_token: value.table_token as string | undefined,
    lines: lines as OrderingOrderLineInput[],
    customer: defined({
      name: customer.name,
      phone: customer.phone,
      email: customer.email as string | undefined,
    }),
    preferences: defined({
      allergy_note: preferences.allergy_note as string | undefined,
      cutlery: preferences.cutlery as boolean | undefined,
      no_contact: preferences.no_contact as boolean | undefined,
      include_allergy_note: preferences.include_allergy_note as boolean | undefined,
    }),
  });
  // `delivery` comes with the delivery channel only, and that channel is Vipps only.
  if (channel !== 'delivery') {
    return value.delivery === undefined ? { ...base, channel, payment_method: payment } : null;
  }
  const delivery = parseDelivery(value.delivery);
  if (delivery === null || payment !== 'vipps') return null;
  return { ...base, channel, payment_method: payment, delivery };
}

/** `ids`, `line_index` and `reason` from a refusal's `details`, when they have their types. */
function refusalDetails(details: unknown): Record<string, unknown> | undefined {
  if (!isRecord(details)) return undefined;
  const picked: Record<string, unknown> = {};
  if (isStrings(details.ids)) picked.ids = details.ids;
  const index = details.line_index;
  if (Number.isSafeInteger(index) && (index as number) >= 0) picked.line_index = index;
  if (isString(details.reason)) picked.reason = details.reason;
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/** A failed `orders.create` in the site's words. */
function placeFailure(error: unknown): ErrorBody {
  const api = apiFailure(error);
  if (!api) return UNAVAILABLE;
  const { status, code } = api;
  if (status === 422 && typeof code === 'string' && REFUSAL_CODES.has(code)) {
    return {
      status: 422,
      code,
      message: 'The order was refused.',
      details: refusalDetails(api.details),
    };
  }
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') {
    return failure(409, 'IDEMPOTENCY_IN_PROGRESS', 'The order is still being placed.');
  }
  if (status === 409 && (code === 'IDEMPOTENCY_KEY_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT')) {
    return failure(409, 'IDEMPOTENCY_CONFLICT', 'The order key was used for another order.');
  }
  if (status === 429) {
    const ms = api.retryAfterMs;
    return {
      ...failure(429, 'RATE_LIMITED', 'Too many orders; try again shortly.'),
      headers:
        typeof ms === 'number' && ms > 0
          ? { 'retry-after': String(Math.ceil(ms / 1000)) }
          : undefined,
    };
  }
  // The configured location is not one Medal knows: the site's setup, not the guest.
  if (code === 'ORDERING_LOCATION_NOT_FOUND') return NOT_CONFIGURED;
  if (code === 'ORDERING_NOT_ENABLED') {
    return failure(404, 'ORDERING_NOT_ENABLED', 'Online ordering is not enabled.');
  }
  if (status === 400) return BAD_BODY;
  return UNAVAILABLE;
}

/** A Next App Router `POST` handler placing the guest's order. */
export function createPlaceOrderRoute(
  options: PlaceOrderRouteOptions
): (request: Request) => Promise<Response> {
  const medal = lazyClient(options);
  const report = reporter(options.onError);

  function notConfigured(reason: string): Response {
    report(new Error(reason));
    return errorResponse(NOT_CONFIGURED);
  }

  /** The configured return page as an absolute `http(s)` URL, or `null`. */
  function returnUrl(request: Request): string | null {
    let value: unknown;
    try {
      value =
        typeof options.returnUrl === 'function' ? options.returnUrl(request) : options.returnUrl;
    } catch {
      return null;
    }
    if (!isString(value) || !URL.canParse(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  }

  return async function POST(request: Request): Promise<Response> {
    const refused = postGuard(request, { crossOrigin: CROSS_ORIGIN, notJson: NOT_JSON });
    if (refused) return errorResponse(refused);
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
    if (idempotencyKey === '' || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return errorResponse(NO_KEY);
    }

    let order: PlaceOrderRequest | null;
    try {
      const text = await readBody(request, MAX_BODY_BYTES);
      if (text === null) return errorResponse(TOO_LARGE);
      order = parsePlaceOrder(JSON.parse(text));
    } catch {
      order = null;
    }
    if (order === null) return errorResponse(BAD_BODY);

    const api = medal();
    if (!api) return notConfigured('The Medal API key is not configured');
    const location = configuredLocation(options.location);
    if (location === null) return notConfigured('The ordering location is not configured');

    let input: OrderingCreateOrderInput;
    if (order.payment_method === 'vipps') {
      const url = returnUrl(request);
      if (url === null) return notConfigured('The Vipps return URL is not configured');
      input =
        order.channel === 'delivery'
          ? { ...order, location_id: location, return_url: url }
          : { ...order, payment_method: 'vipps', location_id: location, return_url: url };
    } else {
      input = { ...order, payment_method: 'pay_at_counter', location_id: location };
    }

    try {
      const { data } = await api.ordering.orders.create(input, {
        idempotencyKey,
        clientIp: readClientIp(options.clientIp, request, report),
        signal: deadline(request, PLACE_DEADLINE_MS),
      });
      return dataResponse(data, 'no-store', 201);
    } catch (error) {
      report(error);
      return errorResponse(placeFailure(error));
    }
  };
}

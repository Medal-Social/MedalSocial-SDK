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
 *   is refused, not dropped.
 *
 * The route adds `location_id` from `location` and, for Vipps, `return_url`
 * from `returnUrl`, then calls Medal once (the SDK retries 429/5xx with the
 * same key) within 15 s or until the guest leaves. `201 { data }` on
 * success. Medal's refusals pass through as `422` with their code and only
 * `ids`, `line_index` and `reason` from `details`; every other failure is a
 * fixed-word code (see `OrderingRouteErrorCode`).
 */

import type {
  OrderingChannel,
  OrderingCreateOrderInput,
  OrderingCreateOrderOptions,
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
  lazyClient,
  NOT_CONFIGURED,
  type RouteBaseOptions,
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
   * The guest's IP address, for Medal's per-IP rate limit. Default: the first
   * of `cf-connecting-ip`, the first `x-forwarded-for` entry and `x-real-ip`.
   * Pass it when the site sits behind a proxy that sets none of those (or
   * lets the client set them); when passed, the headers are not read.
   */
  clientIp?: (request: Request) => string | null | undefined;
}

/** The body cap: a full cart is a few KB. */
const MAX_BODY_BYTES = 32 * 1024;

/** The cap on the `Idempotency-Key` the browser sends. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** The whole Medal call, the SDK's retries included. */
const PLACE_DEADLINE_MS = 15_000;

const CHANNELS: readonly OrderingChannel[] = ['dine_in', 'takeaway', 'delivery'];
const PAYMENT_METHODS: readonly OrderingPaymentMethod[] = ['pay_at_counter', 'vipps'];

const REFUSAL_CODES: ReadonlySet<string> = new Set<OrderingRefusalCode>([
  'CLOSED',
  'CUTOFF',
  'CHANNEL_NOT_AVAILABLE',
  'PREORDER_DISABLED',
  'TABLE_NOT_FOUND',
  'SOLD_OUT',
  'UNAVAILABLE',
  'INVALID_OPTIONS',
  'INVALID_CART',
  'PAYMENT_METHOD_NOT_ALLOWED',
  'PAYMENT_UNAVAILABLE',
  'RETURN_URL_NOT_ALLOWED',
  'INVALID_CUSTOMER',
]);

function failure(status: number, code: OrderingRouteErrorCode, message: string): ErrorBody {
  return { status, code, message };
}

const CROSS_ORIGIN = failure(403, 'INVALID_REQUEST', 'Orders are placed from this site only.');
const NOT_JSON = failure(415, 'INVALID_REQUEST', 'The order must be sent as application/json.');
const NO_KEY = failure(400, 'INVALID_REQUEST', 'Idempotency-Key must be 1-100 characters.');
const TOO_LARGE = failure(413, 'INVALID_REQUEST', 'The order is too large.');
const BAD_BODY = failure(400, 'INVALID_REQUEST', 'The order is not one this site takes.');
const UNAVAILABLE = failure(502, 'SERVICE_UNAVAILABLE', 'Orders cannot be placed right now.');

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A plain object with only these keys. */
function only(value: unknown, keys: readonly string[]): value is Json {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

/** Absent, or a value `check` takes. `null` is not absent: Medal omits, never nulls. */
function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
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

  if (!only(preferences, ['allergy_note', 'cutlery', 'no_contact'])) return null;
  if (!isBoolean(preferences.cutlery) || !optional(preferences.allergy_note, isString)) {
    return null;
  }
  if (!optional(preferences.no_contact, isBoolean)) return null;

  return defined({
    channel,
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
      cutlery: preferences.cutlery,
      no_contact: preferences.no_contact as boolean | undefined,
    }),
    payment_method: payment,
  });
}

/** The media type of a `Content-Type`, without parameters, lower-cased. */
function mediaType(header: string | null): string {
  const [type = ''] = (header ?? '').split(';');
  return type.trim().toLowerCase();
}

/**
 * The body as text, or `null` when it is over the cap. Read chunk by chunk
 * so an endless body stops at the cap; a declared `Content-Length` over it
 * is refused without reading. Rejects for a failing stream or bytes that are
 * not UTF-8.
 */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
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

  function clientIp(request: Request): string | undefined {
    if (options.clientIp) {
      try {
        return options.clientIp(request)?.trim() || undefined;
      } catch (error) {
        report(error);
        return undefined;
      }
    }
    const headers = request.headers;
    const candidates = [
      headers.get('cf-connecting-ip'),
      headers.get('x-forwarded-for')?.split(',')[0],
      headers.get('x-real-ip'),
    ];
    return candidates.map((value) => value?.trim()).find((value) => value) || undefined;
  }

  return async function POST(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
      return errorResponse(CROSS_ORIGIN);
    }
    if (mediaType(request.headers.get('content-type')) !== 'application/json') {
      return errorResponse(NOT_JSON);
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
    if (idempotencyKey === '' || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return errorResponse(NO_KEY);
    }

    let order: PlaceOrderRequest | null;
    try {
      const text = await readBody(request);
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
      input = { ...order, payment_method: 'vipps', location_id: location, return_url: url };
    } else {
      input = { ...order, payment_method: 'pay_at_counter', location_id: location };
    }

    try {
      const { data } = await api.ordering.orders.create(input, {
        idempotencyKey,
        clientIp: clientIp(request),
        signal: deadline(request, PLACE_DEADLINE_MS),
      });
      return dataResponse(data, 'no-store', 201);
    } catch (error) {
      report(error);
      return errorResponse(placeFailure(error));
    }
  };
}

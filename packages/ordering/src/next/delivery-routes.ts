/**
 * The delivery routes: address autocomplete, address verification and a
 * live Wolt price, through the site so the API key stays on the server.
 *
 * ```ts
 * // app/api/ordering/address/route.ts — GET ?q=storgata 1&session=…
 * export const GET = createAddressSuggestRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * // app/api/ordering/address/resolve/route.ts — POST { id, session }
 * export const POST = createAddressResolveRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * // app/api/ordering/delivery-quote/route.ts — POST { address_id, order_total }
 * export const POST = createDeliveryQuoteRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * ```
 *
 * Every answer is `no-store`: a lookup and a price are the visitor's own.
 * The two `POST`s take the place route's checks — same origin (`403`), JSON
 * (`415`), a small body (`413`) of exactly the keys they take (`400`).
 *
 * A quote is a Wolt call on the workspace key's budget (30 a minute) and can
 * take 20 s, so the quote route takes only the address and the cart's
 * subtotal — never a venue, bags or prep time from the browser — gives Medal
 * one attempt of up to 25 s, and spends at most `maxQuotesPerMinute` Medal
 * calls a minute in each route instance (a script cannot drain the key);
 * past it, `503 SERVICE_UNAVAILABLE` without a call.
 *
 * Medal's delivery refusals become fixed-word codes the checkout tells
 * apart (see `OrderingRouteErrorCode`): `ADDRESS_NOT_VERIFIED` (`422`),
 * `ADDRESS_NOT_DELIVERABLE` (`422`, Wolt's `NOT_DELIVERABLE` too),
 * `DELIVERY_UNAVAILABLE` (`409`: not set up, paused, or the venue
 * unavailable) and `QUOTE_TIMEOUT` (`504`). The rest are the read routes'
 * (`429` → `503 SERVICE_UNAVAILABLE`: the site's key, not the visitor).
 */

import type {
  DeliveryAddressOptions,
  DeliveryAddressSuggestion,
  DeliveryQuote,
  DeliveryQuoteInput,
  DeliveryQuoteOptions,
  DeliveryResolvedAddress,
} from '@medalsocial/sdk';
import type { OrderingRouteErrorCode } from '../core/checkout';
import {
  apiFailure,
  dataResponse,
  deadline,
  type ErrorBody,
  errorResponse,
  invalidRequest,
  isString,
  lazyClient,
  NOT_CONFIGURED,
  only,
  optional,
  postGuard,
  READ_DEADLINE_MS,
  type RouteBaseOptions,
  readBody,
  readFailure,
  readRoute,
  reporter,
} from './shared';

/** The slice of the SDK client the suggest route uses — what a test injects. */
export interface AddressSuggestClient {
  delivery: {
    addresses: {
      suggest(
        query: string,
        options?: DeliveryAddressOptions
      ): Promise<{ data: DeliveryAddressSuggestion[] }>;
    };
  };
}

/** The slice of the SDK client the resolve route uses. */
export interface AddressResolveClient {
  delivery: {
    addresses: {
      resolve(
        id: string,
        options?: DeliveryAddressOptions
      ): Promise<{ data: DeliveryResolvedAddress }>;
    };
  };
}

/** The slice of the SDK client the quote route uses. */
export interface DeliveryQuoteClient {
  delivery: {
    quotes: {
      create(
        input: DeliveryQuoteInput,
        options?: DeliveryQuoteOptions
      ): Promise<{ data: DeliveryQuote }>;
    };
  };
}

export type AddressSuggestRouteOptions = RouteBaseOptions<AddressSuggestClient>;
export type AddressResolveRouteOptions = RouteBaseOptions<AddressResolveClient>;

export interface DeliveryQuoteRouteOptions extends RouteBaseOptions<DeliveryQuoteClient> {
  /**
   * Most Medal quote calls a minute in this route instance; past it the route
   * answers `503 SERVICE_UNAVAILABLE` without calling Medal. A non-negative
   * integer; `0` turns quotes off. Default 20, under the key's 30.
   */
  maxQuotesPerMinute?: number;
}

const DEFAULT_MAX_QUOTES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** The quote's one Medal attempt: the server waits up to 20 s for Wolt. */
const QUOTE_DEADLINE_MS = 25_000;

/** A lookup or a quote body is a few hundred bytes. */
const MAX_BODY_BYTES = 4 * 1024;

/** The API's caps. */
const MAX_QUERY_LENGTH = 200;
const MAX_SUGGESTION_ID_LENGTH = 320;
const MAX_ADDRESS_ID_LENGTH = 64;
const MAX_ORDER_TOTAL = 100_000_000;
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;

function failure(status: number, code: OrderingRouteErrorCode, message: string): ErrorBody {
  return { status, code, message };
}

const POST_REFUSALS = {
  crossOrigin: failure(403, 'INVALID_REQUEST', 'Delivery is asked for from this site only.'),
  notJson: failure(415, 'INVALID_REQUEST', 'The request must be sent as application/json.'),
};
const TOO_LARGE = failure(413, 'INVALID_REQUEST', 'The request is too large.');
const BAD_BODY = invalidRequest('The request is not one this site takes.');
const BUDGET_SPENT = failure(
  503,
  'SERVICE_UNAVAILABLE',
  'Delivery prices are not available right now.'
);

const NOT_VERIFIED = failure(422, 'ADDRESS_NOT_VERIFIED', 'The address could not be verified.');
const NOT_DELIVERABLE = failure(
  422,
  'ADDRESS_NOT_DELIVERABLE',
  'Delivery to this address is not possible right now.'
);
const DELIVERY_OFF = failure(409, 'DELIVERY_UNAVAILABLE', 'Delivery is not available right now.');

/** Medal's delivery codes the browser tells apart. */
const DELIVERY_FAILURE: Readonly<Record<string, ErrorBody>> = {
  ADDRESS_NOT_VERIFIED: NOT_VERIFIED,
  NOT_DELIVERABLE: NOT_DELIVERABLE,
  ADDRESS_NOT_DELIVERABLE: NOT_DELIVERABLE,
  DELIVERY_NOT_SET_UP: DELIVERY_OFF,
  DELIVERY_PAUSED: DELIVERY_OFF,
  VENUE_UNAVAILABLE: DELIVERY_OFF,
  QUOTE_TIMEOUT: failure(504, 'QUOTE_TIMEOUT', 'The delivery price did not come in time.'),
};

/** A failed delivery call in the site's words; anything else as a read route answers it. */
function deliveryFailure(error: unknown): ErrorBody {
  const code = apiFailure(error)?.code;
  if (typeof code === 'string' && Object.hasOwn(DELIVERY_FAILURE, code)) {
    return DELIVERY_FAILURE[code] as ErrorBody;
  }
  return readFailure(error, null);
}

/** A non-blank id of at most `max` characters, sent unchanged (the API's ids are opaque). */
function isId(value: unknown, max: number): value is string {
  return isString(value) && value.trim() !== '' && value.length <= max;
}

const isSession = (value: unknown): value is string => isString(value) && SESSION.test(value);

/**
 * The checked JSON body of a browser `POST`, or the error to answer: the
 * same-origin and JSON checks, the size cap, then `parse` (`null`: a `400`).
 */
async function postBody<T>(
  request: Request,
  parse: (value: unknown) => T | null
): Promise<{ body: T } | { error: ErrorBody }> {
  const refused = postGuard(request, POST_REFUSALS);
  if (refused) return { error: refused };
  let body: T | null;
  try {
    const text = await readBody(request, MAX_BODY_BYTES);
    if (text === null) return { error: TOO_LARGE };
    body = parse(JSON.parse(text));
  } catch {
    body = null;
  }
  return body === null ? { error: BAD_BODY } : { body };
}

/**
 * A Next App Router `GET` handler: `?q=&session=` → `{ data:
 * DeliveryAddressSuggestion[] }`, up to 8 Norwegian addresses, nearest the
 * restaurant first. `q` is at most 200 characters (under 3 answers an empty
 * list from Medal); `session` (optional, 8–64 of `A-Z a-z 0-9 _ -`) is the
 * same for the suggestions and the resolve of one lookup.
 */
export function createAddressSuggestRoute(
  options: AddressSuggestRouteOptions
): (request: Request) => Promise<Response> {
  return readRoute<AddressSuggestClient, { q: string; session?: string }>(options, {
    parse(request) {
      const params = new URL(request.url).searchParams;
      const q = params.get('q');
      if (q === null || q.length > MAX_QUERY_LENGTH) {
        return { error: invalidRequest('q must be at most 200 characters.') };
      }
      const session = params.get('session') || undefined;
      if (!optional(session, isSession)) {
        return { error: invalidRequest('session must be 8-64 of A-Z, a-z, 0-9, _ and -.') };
      }
      return { args: { q, session } };
    },
    call: (api, { q, session }, signal) => api.delivery.addresses.suggest(q, { session, signal }),
    notFound: null,
    cacheControl: 'no-store',
    failure: deliveryFailure,
  });
}

/**
 * A Next App Router `POST` handler: `{ id, session? }` → `{ data:
 * DeliveryResolvedAddress }`, the picked suggestion verified against the
 * address register. `422 ADDRESS_NOT_VERIFIED` when it is not a door there
 * (a missing house number, most often).
 */
export function createAddressResolveRoute(
  options: AddressResolveRouteOptions
): (request: Request) => Promise<Response> {
  const medal = lazyClient(options);
  const report = reporter(options.onError);
  return async function POST(request: Request): Promise<Response> {
    const parsed = await postBody(request, (value) => {
      if (!only(value, ['id', 'session'])) return null;
      const { id, session } = value;
      if (!isId(id, MAX_SUGGESTION_ID_LENGTH) || !optional(session, isSession)) return null;
      return { id, session: session as string | undefined };
    });
    if ('error' in parsed) return errorResponse(parsed.error);
    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }
    const { id, session } = parsed.body;
    try {
      const { data } = await api.delivery.addresses.resolve(id, {
        session,
        signal: deadline(request, READ_DEADLINE_MS),
      });
      return dataResponse(data, 'no-store');
    } catch (error) {
      report(error);
      return errorResponse(deliveryFailure(error));
    }
  };
}

/**
 * A Next App Router `POST` handler: `{ address_id, order_total }` → `201 {
 * data: DeliveryQuote }`. `address_id` is the resolved address's;
 * `order_total` the cart's subtotal in whole øre (0–100 000 000), which the
 * order must match.
 */
export function createDeliveryQuoteRoute(
  options: DeliveryQuoteRouteOptions
): (request: Request) => Promise<Response> {
  const maxQuotes = options.maxQuotesPerMinute ?? DEFAULT_MAX_QUOTES_PER_MINUTE;
  if (!Number.isSafeInteger(maxQuotes) || maxQuotes < 0) {
    throw new RangeError(
      `createDeliveryQuoteRoute: maxQuotesPerMinute must be a non-negative integer, got ${maxQuotes}`
    );
  }
  // One attempt that may take the whole deadline: the SDK sends a quote once.
  const medal = lazyClient(options, QUOTE_DEADLINE_MS);
  const report = reporter(options.onError);
  const budget = { windowStart: Number.NEGATIVE_INFINITY, used: 0 };

  /** Take one quote from this minute's budget; `false` when it is spent. */
  function spendQuote(): boolean {
    const now = Date.now();
    if (now - budget.windowStart >= MINUTE_MS) {
      budget.windowStart = now;
      budget.used = 0;
    }
    if (budget.used >= maxQuotes) return false;
    budget.used += 1;
    return true;
  }

  return async function POST(request: Request): Promise<Response> {
    const parsed = await postBody(request, (value): DeliveryQuoteInput | null => {
      if (!only(value, ['address_id', 'order_total'])) return null;
      const { address_id, order_total } = value;
      if (!isId(address_id, MAX_ADDRESS_ID_LENGTH)) return null;
      if (!Number.isSafeInteger(order_total)) return null;
      const total = order_total as number;
      return total >= 0 && total <= MAX_ORDER_TOTAL ? { address_id, order_total: total } : null;
    });
    if ('error' in parsed) return errorResponse(parsed.error);
    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }
    if (!spendQuote()) return errorResponse(BUDGET_SPENT);
    try {
      const { data } = await api.delivery.quotes.create(parsed.body, {
        signal: deadline(request, QUOTE_DEADLINE_MS),
      });
      return dataResponse(data, 'no-store', 201);
    } catch (error) {
      report(error);
      return errorResponse(deliveryFailure(error));
    }
  };
}

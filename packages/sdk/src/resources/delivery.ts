import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  DeliveryAddressOptions,
  DeliveryAddressSuggestion,
  DeliveryQuote,
  DeliveryQuoteInput,
  DeliveryQuoteOptions,
  DeliveryResolvedAddress,
} from "../types/delivery";

/**
 * Named so the client calls below carry a flat type argument — the OpenAPI
 * coverage gate matches `this.client.<verb><T>(` without nested generics.
 */
type SuggestionsEnvelope = ApiResponse<DeliveryAddressSuggestion[]>;
type ResolvedAddressEnvelope = ApiResponse<DeliveryResolvedAddress>;
type QuoteEnvelope = ApiResponse<DeliveryQuote>;

/** The API's cap on what the customer typed. */
const MAX_QUERY_LENGTH = 200;
/** The API's cap on a suggestion id. */
const MAX_SUGGESTION_ID_LENGTH = 320;
/** The API's cap on an address or venue id. */
const MAX_ID_LENGTH = 64;
/** The API's `session` format. */
const SESSION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Check an address lookup `session` before sending it.
 *
 * @throws RangeError for anything but 8-64 characters of `A-Z a-z 0-9 _ -`.
 */
function checkSession(method: string, session: string | undefined): string | undefined {
  if (session === undefined) return undefined;
  if (typeof session !== "string" || !SESSION_PATTERN.test(session)) {
    throw new RangeError(
      `${method}: session must be 8-64 characters of A-Z, a-z, 0-9, _ and -, got ${JSON.stringify(session)}`,
    );
  }
  return session;
}

/**
 * Check a required id. It is sent unchanged: the API's ids are opaque.
 *
 * @throws RangeError for a non-string, blank or over-long value.
 */
function checkId(method: string, name: string, value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new RangeError(
      `${method}: ${name} must be 1-${max} characters, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Check an optional whole number against the API's range.
 *
 * @throws RangeError for a value that is not a whole number in `min`-`max`.
 */
function checkWhole(name: string, value: unknown, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RangeError(
      `delivery.quotes.create: ${name} must be a whole number ${min}-${max}, got ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Address autocomplete and verification: `medal.delivery.addresses`. Scope
 * `delivery.address.read`. Too many lookups answers `429 RATE_LIMITED`
 * (retry in a minute).
 */
export class DeliveryAddresses {
  constructor(private client: BaseClient) {}

  /**
   * Up to 8 Norwegian street addresses for what the customer typed, nearest
   * the restaurant first: Kartverket (the national address register) first,
   * Google only when Kartverket has no hit. Fewer than 3 characters (after
   * normalising) answers an empty list, so call it on every keystroke without
   * a guard of your own. The ids are opaque: {@link resolve} the one the
   * customer picks before quoting.
   *
   * Pass the same `session` (one per address the customer enters, a UUID say)
   * here and to {@link resolve}.
   *
   * ```ts
   * const session = crypto.randomUUID();
   * const { data: suggestions } = await medal.delivery.addresses.suggest("storgata 1", {
   *   session,
   *   signal: keystroke.signal,
   * });
   * // [{ id: "kv_…", label: "Storgata 1", secondary: "0155 Oslo" }, …]
   * ```
   *
   * @throws RangeError before any request for a `query` over 200 characters
   * or a malformed `session`.
   */
  async suggest(query: string, options?: DeliveryAddressOptions): Promise<SuggestionsEnvelope> {
    if (typeof query !== "string" || query.length > MAX_QUERY_LENGTH) {
      throw new RangeError(
        `delivery.addresses.suggest: query must be a string of at most ${MAX_QUERY_LENGTH} characters, got ${JSON.stringify(query)}`,
      );
    }
    const session = checkSession("delivery.addresses.suggest", options?.session);
    return this.client.get<SuggestionsEnvelope>(
      "/api/v1/delivery/addresses",
      { q: query, session },
      { signal: options?.signal },
    );
  }

  /**
   * Turn a suggestion `id` into a verified address with coordinates. Only an
   * address in the Kartverket register with a house number is verified; a
   * Google suggestion is confirmed against Kartverket, whose postcode wins.
   * The answer's `address_id` is what {@link DeliveryQuotes.create},
   * `portal.ordering.addresses.add()` and a delivery order take.
   *
   * Errors: `422 ADDRESS_NOT_VERIFIED` (no such door, or no house number —
   * ask the customer for one), `503 ADDRESS_LOOKUP_UNAVAILABLE` (the register
   * could not be reached), `429 RATE_LIMITED`.
   *
   * ```ts
   * const { data: address } = await medal.delivery.addresses.resolve(picked.id, { session });
   * // { address_id, label: "Storgata 1, 0155 Oslo", street, house_number, post_code, city, lat, lon, source }
   * ```
   *
   * @throws RangeError before any request for a blank or over-long id
   * (over 320 characters) or a malformed `session`.
   */
  async resolve(id: string, options?: DeliveryAddressOptions): Promise<ResolvedAddressEnvelope> {
    const suggestionId = checkId("delivery.addresses.resolve", "id", id, MAX_SUGGESTION_ID_LENGTH);
    const session = checkSession("delivery.addresses.resolve", options?.session);
    return this.client.post<ResolvedAddressEnvelope>(
      "/api/v1/delivery/addresses/resolve",
      session === undefined ? { id: suggestionId } : { id: suggestionId, session },
      { signal: options?.signal },
    );
  }
}

/**
 * Live Wolt prices: `medal.delivery.quotes`. Scope `delivery.quote.create`,
 * 30/min per key.
 */
export class DeliveryQuotes {
  constructor(private client: BaseClient) {}

  /**
   * Ask Wolt for a binding delivery price to a verified address, with the
   * restaurant's customer fee policy applied (Wolt's price, a fixed fee, or
   * free over an order total). Resolves `201` with
   * `{ quote_id, customer_fee, cost, eta_minutes, delivered_by, valid_until, address, venue_id }`.
   *
   * Every call is a fresh Wolt quote, and the server waits up to 20 s for
   * Wolt. The call is therefore sent exactly once — the SDK's automatic
   * retry on 429/5xx would spend the 30/min quote budget and stack 20 s
   * waits. Retry yourself when it makes sense (a `504 QUOTE_TIMEOUT`, say).
   * A client `timeout` under about 25 s can abort a quote that would have
   * succeeded.
   *
   * For an online order: `order_total` must be the cart subtotal in øre and
   * `address_id` the resolved `address_id`. Then pass the quote's `quote_id`
   * and that same `address_id` to `ordering.orders.create()` as
   * `delivery: { verified_address_id, quote_id, … }`. Make a new quote when
   * the cart subtotal changes, and when `valid_until` is less than a minute
   * away: the order is refused with `422 QUOTE_NOT_USABLE` /
   * `QUOTE_EXPIRED` otherwise.
   *
   * ```ts
   * const { data: quote } = await medal.delivery.quotes.create({
   *   address_id: address.address_id,
   *   order_total: cart.subtotal_ore,
   * });
   * showFee(quote.customer_fee); // { amount: 4900, currency: "NOK" } or null
   *
   * await medal.ordering.orders.create(
   *   {
   *     ...order,
   *     channel: "delivery",
   *     payment_method: "vipps",
   *     return_url,
   *     delivery: { verified_address_id: address.address_id, quote_id: quote.quote_id },
   *   },
   *   { idempotencyKey: cart.idempotencyKey },
   * );
   * ```
   *
   * Errors: `400 INVALID_REQUEST`, `409 DELIVERY_NOT_SET_UP` /
   * `DELIVERY_PAUSED` / `VENUE_UNAVAILABLE`, `422 ADDRESS_NOT_VERIFIED`,
   * `422 NOT_DELIVERABLE` (Wolt cannot deliver there right now),
   * `422 ADDRESS_NOT_DELIVERABLE` (Wolt will not promise delivery to that
   * address), `429 RATE_LIMITED`, `504 QUOTE_TIMEOUT`.
   *
   * @throws RangeError before any request for a blank or over-long
   * `address_id` / `venue_id` (over 64 characters), or a `bags` (1-20),
   * `prep_minutes` (0-60) or `order_total` (0-100 000 000) that is not a
   * whole number in range.
   */
  async create(input: DeliveryQuoteInput, options?: DeliveryQuoteOptions): Promise<QuoteEnvelope> {
    checkId("delivery.quotes.create", "address_id", input?.address_id, MAX_ID_LENGTH);
    if (input.venue_id !== undefined) {
      checkId("delivery.quotes.create", "venue_id", input.venue_id, MAX_ID_LENGTH);
    }
    checkWhole("bags", input.bags, 1, 20);
    checkWhole("prep_minutes", input.prep_minutes, 0, 60);
    checkWhole("order_total", input.order_total, 0, 100_000_000);
    return this.client.post<QuoteEnvelope>("/api/v1/delivery/quotes", input, {
      retry: false,
      signal: options?.signal,
    });
  }
}

/**
 * Wolt delivery for a restaurant's online store, through Medal:
 * `medal.delivery`. Call it server-side with the workspace API key:
 * autocomplete a Norwegian address, verify it against Kartverket, and get a
 * live Wolt price with the restaurant's customer fee applied. Amounts are
 * integer NOK øre.
 *
 * ```ts
 * const { data: suggestions } = await medal.delivery.addresses.suggest(typed, { session });
 * const { data: address } = await medal.delivery.addresses.resolve(suggestions[0].id, { session });
 * const { data: quote } = await medal.delivery.quotes.create({
 *   address_id: address.address_id,
 *   order_total: cart.subtotal_ore,
 * });
 * ```
 */
export class Delivery {
  /** Autocomplete and verify an address: `suggest`, `resolve`. */
  readonly addresses: DeliveryAddresses;
  /** Live Wolt prices: `create`. */
  readonly quotes: DeliveryQuotes;

  constructor(client: BaseClient) {
    this.addresses = new DeliveryAddresses(client);
    this.quotes = new DeliveryQuotes(client);
  }
}

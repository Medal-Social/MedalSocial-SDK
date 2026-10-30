import type { BaseClient, RequestOptions } from "../client";
import { type ApiResponse, MedalApiError } from "../types/common";
import type {
  OrderingChannel,
  OrderingCreateOrderInput,
  OrderingCreateOrderOptions,
  OrderingCustomerOrder,
  OrderingErrorDetails,
  OrderingInstantInput,
  OrderingLocations,
  OrderingMenu,
  OrderingMenuOptions,
  OrderingMenuResult,
  OrderingOrderCreated,
  OrderingOrderStatusView,
  OrderingRefusalCode,
  OrderingSlots,
  OrderingSlotsOptions,
  OrderingTable,
} from "../types/ordering";

/**
 * Named so the client call below carries a flat type argument — the OpenAPI
 * coverage gate matches `this.client.<verb><T>(` without nested generics.
 */
type MenuEnvelope = ApiResponse<OrderingMenu>;
type LocationsEnvelope = ApiResponse<OrderingLocations>;
type SlotsEnvelope = ApiResponse<OrderingSlots>;
type OrderCreatedEnvelope = ApiResponse<OrderingOrderCreated>;
type CustomerOrderEnvelope = ApiResponse<OrderingCustomerOrder>;
type StatusViewEnvelope = ApiResponse<OrderingOrderStatusView>;
type TableEnvelope = ApiResponse<OrderingTable>;

const CHANNELS: readonly OrderingChannel[] = ["dine_in", "takeaway", "delivery"];
/** The API's cap on a location id. */
const MAX_LOCATION_ID_LENGTH = 64;
/** The API's cap on an order id and a table token. */
const MAX_PATH_ID_LENGTH = 64;
/** The API's cap on an `Idempotency-Key`. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

const REFUSAL_CODES: ReadonlySet<string> = new Set<OrderingRefusalCode>([
  "CLOSED",
  "CUTOFF",
  "CHANNEL_NOT_AVAILABLE",
  "PREORDER_DISABLED",
  "SLOT_TAKEN",
  "TABLE_NOT_FOUND",
  "SOLD_OUT",
  "UNAVAILABLE",
  "INVALID_OPTIONS",
  "INVALID_CART",
  "PAYMENT_METHOD_NOT_ALLOWED",
  "PAYMENT_UNAVAILABLE",
  "RETURN_URL_NOT_ALLOWED",
  "INVALID_CUSTOMER",
  "QUOTE_NOT_USABLE",
  "QUOTE_EXPIRED",
  "SAVED_ADDRESS_NOT_FOUND",
]);

/**
 * A `422` refusal from `ordering.orders.create()`, narrowed by
 * {@link isOrderingRefusal}: a {@link MedalApiError} whose `code` is an
 * {@link OrderingRefusalCode} and whose `details` (when sent) carry `ids`,
 * `line_index` or `reason`.
 */
export type OrderingRefusalError = MedalApiError & {
  readonly status: 422;
  readonly code: OrderingRefusalCode;
  readonly details?: OrderingErrorDetails;
};

/**
 * Is this caught error a business refusal of an order? Narrows `code` to an
 * {@link OrderingRefusalCode} and `details` to {@link OrderingErrorDetails}.
 *
 * ```ts
 * try {
 *   await medal.ordering.orders.create(body, { idempotencyKey: cart.key });
 * } catch (error) {
 *   if (isOrderingRefusal(error) && error.code === "SOLD_OUT") {
 *     markSoldOut(error.details?.ids ?? []);
 *   } else throw error;
 * }
 * ```
 *
 * It answers `false` for a `422` whose `details` is present but does not have
 * that shape (not an object, `ids` not a string array, `line_index` not a
 * non-negative integer, `reason` not a string), so the narrowed `details`
 * type never lies; read `error.details` yourself in that case.
 */
export function isOrderingRefusal(error: unknown): error is OrderingRefusalError {
  if (!(error instanceof MedalApiError)) return false;
  if (error.status !== 422 || !REFUSAL_CODES.has(error.code)) return false;
  return error.details === undefined || isOrderingErrorDetails(error.details);
}

/** Does a `details` value really have the {@link OrderingErrorDetails} shape? */
function isOrderingErrorDetails(value: unknown): value is OrderingErrorDetails {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { ids, line_index, reason, status } = value as Record<string, unknown>;
  if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) {
    return false;
  }
  if (
    line_index !== undefined &&
    !(Number.isSafeInteger(line_index) && (line_index as number) >= 0)
  ) {
    return false;
  }
  if (reason !== undefined && typeof reason !== "string") return false;
  return status === undefined || typeof status === "string";
}

/**
 * Check an order id or table token before it goes into a path.
 *
 * @throws RangeError for a blank, over-long or dot-segment value.
 */
function checkPathId(method: string, name: string, value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > MAX_PATH_ID_LENGTH) {
    throw new RangeError(
      `${method}: ${name} must be 1-${MAX_PATH_ID_LENGTH} characters, got ${JSON.stringify(value)}`,
    );
  }
  // `encodeURIComponent` leaves `.` and `..` alone and URL parsing resolves
  // them as path segments, so `..` would send the call to another route.
  if (trimmed === "." || trimmed === "..") {
    throw new RangeError(`${method}: ${name} must not be ${JSON.stringify(trimmed)}`);
  }
  return trimmed;
}

/** Per-call options for ordering reads. */
export type OrderingReadOptions = Pick<RequestOptions, "signal">;

/**
 * The wire form of `at`: a `Date` as `toISOString()`, Unix milliseconds as
 * digits, a string unchanged.
 *
 * @throws RangeError for a number that is not a non-negative integer — the API
 * only takes whole milliseconds as digits, so `1.5` or `-1` would be a 400.
 */
function serialiseInstant(at: OrderingInstantInput): string {
  if (at instanceof Date) return at.toISOString();
  if (typeof at === "number") {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new RangeError(`ordering.menu: at must be whole Unix milliseconds, got ${at}`);
    }
    return String(at);
  }
  return at;
}

/**
 * Check `ordering.slots()` input before sending it, so a typo fails with a
 * clear message instead of a round trip to a 400.
 *
 * @throws RangeError for a blank or over-long location, an unknown channel,
 * or a date that is not a real `yyyy-mm-dd` calendar date.
 */
function checkSlotsOptions(options: OrderingSlotsOptions): OrderingSlotsOptions {
  const location = options.location.trim();
  if (!location || location.length > MAX_LOCATION_ID_LENGTH) {
    throw new RangeError(
      `ordering.slots: location must be 1-${MAX_LOCATION_ID_LENGTH} characters, got ${JSON.stringify(options.location)}`,
    );
  }
  if (!CHANNELS.includes(options.channel)) {
    throw new RangeError(
      `ordering.slots: channel must be one of ${CHANNELS.join(", ")}, got ${JSON.stringify(options.channel)}`,
    );
  }
  const date = options.date.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(
      `ordering.slots: date must be a real calendar date as yyyy-mm-dd, got ${JSON.stringify(options.date)}`,
    );
  }
  return { location, channel: options.channel, date };
}

/**
 * Restaurant online ordering, for the restaurant's own site. Call it
 * server-side with the workspace API key: scope `ordering.storefront.read`
 * for the menu, locations, slots and tables; `orders` has its own scopes.
 *
 * A workspace without the online-ordering module answers every call with
 * `403 ORDERING_NOT_ENABLED`.
 */
export class Ordering {
  /** Place, read, poll and cancel a guest's order. */
  readonly orders: OrderingOrders;

  constructor(private client: BaseClient) {
    this.orders = new OrderingOrders(client);
  }

  /**
   * Resolve the token in a table's QR code to its location and label, so the
   * site can open the dine-in menu for that table and send the token with the
   * order as `table_token`. The token is URL-encoded into the path. An unknown
   * or archived table is `404 TABLE_NOT_FOUND`. Scope
   * `ordering.storefront.read`; the response is `private, no-store`.
   *
   * ```ts
   * const { data } = await medal.ordering.table(searchParams.get("t") ?? "");
   * // { location_id: "loc_1", table_label: "12" }
   * ```
   *
   * @throws RangeError before any request for a blank or over-long token.
   */
  async table(tableToken: string, request?: OrderingReadOptions): Promise<TableEnvelope> {
    const token = checkPathId("ordering.table", "token", tableToken);
    return this.client.get<TableEnvelope>(
      `/api/v1/ordering/tables/${encodeURIComponent(token)}`,
      undefined,
      { signal: request?.signal },
    );
  }

  /**
   * What a guest can order on one channel at one instant: active dishes in
   * open categories and time windows, with their modifier groups. Sold-out
   * dishes and options stay listed with `sold_out: true`.
   *
   * The API marks the menu `Cache-Control: private, no-store`, so cache it
   * yourself and revalidate with the ETag:
   *
   * ```ts
   * const first = await medal.ordering.menu({ channel: "takeaway" });
   * // later
   * const next = await medal.ordering.menu({ channel: "takeaway", ifNoneMatch: first.etag });
   * const menu = next.notModified ? cached : next.menu;
   * ```
   *
   * @throws RangeError before any request when `at` is a number that is not
   * whole Unix milliseconds, or an invalid `Date`.
   */
  async menu(
    options: OrderingMenuOptions,
    request?: OrderingReadOptions,
  ): Promise<OrderingMenuResult> {
    const res = await this.client.getConditional<MenuEnvelope>(
      "/api/v1/ordering/menu",
      {
        channel: options.channel,
        location: options.location,
        at: options.at === undefined ? undefined : serialiseInstant(options.at),
      },
      { signal: request?.signal, ifNoneMatch: options.ifNoneMatch },
    );
    if (res.notModified) {
      // A 304 only answers an If-None-Match, so the tag we sent is current
      // even when a proxy stripped the header from the response.
      return { notModified: true, etag: res.etag ?? options.ifNoneMatch?.trim() ?? "" };
    }
    const menu = res.body.data;
    return { notModified: false, etag: res.etag ?? menu.etag, menu };
  }

  /**
   * Every location that takes online orders, with each channel's state right
   * now (`enabled`, `open`, and when closed the `reason` and next
   * `opens_at`), payment methods, `preorder_days` and `slot_minutes`.
   * Instants are ISO 8601 UTC; render them in `data.time_zone`.
   *
   * The API marks the response `Cache-Control: private, no-store`: the open
   * state changes by the minute, so read it per request.
   */
  async locations(request?: OrderingReadOptions): Promise<LocationsEnvelope> {
    return this.client.get<LocationsEnvelope>("/api/v1/ordering/locations", undefined, {
      signal: request?.signal,
    });
  }

  /**
   * The pickup or delivery slots a guest can pick on one service date for
   * one channel at one location. `date` is in the workspace time zone and
   * must be today through today + the location's `preorder_days`
   * (`400 VALIDATION_ERROR` otherwise); an unknown location is
   * `404 NOT_FOUND`. A channel that is off or a closed day gives an empty
   * `slots` list.
   *
   * ```ts
   * const { data } = await medal.ordering.locations();
   * const loc = data.locations[0];
   * const { data: day } = await medal.ordering.slots({
   *   location: loc.id,
   *   channel: "takeaway",
   *   date: "2026-10-21",
   * });
   * ```
   *
   * @throws RangeError before any request for a blank or over-long
   * `location`, an unknown `channel`, or a `date` that is not a real
   * `yyyy-mm-dd` date.
   */
  async slots(
    options: OrderingSlotsOptions,
    request?: OrderingReadOptions,
  ): Promise<SlotsEnvelope> {
    const params = checkSlotsOptions(options);
    return this.client.get<SlotsEnvelope>(
      "/api/v1/ordering/slots",
      { location: params.location, channel: params.channel, date: params.date },
      { signal: request?.signal },
    );
  }
}

/**
 * A guest's orders: `medal.ordering.orders`. Call it server-side with the
 * workspace API key — `create` and `cancel` need `ordering.order.create`,
 * `get` and `status` need `ordering.order.read`. An order of another
 * workspace, or an unknown id, is `404 ORDER_NOT_FOUND`.
 */
export class OrderingOrders {
  constructor(private client: BaseClient) {}

  /**
   * Place an order. Resolves `201` the first time and `200` when the same
   * key and body is sent again; both carry `{ order_id, order_number, status }`.
   *
   * The `idempotencyKey` is required and goes out as `Idempotency-Key` on
   * every attempt, so the SDK's automatic retry on 429/5xx replays instead of
   * placing a second order. A business refusal is a `422` {@link MedalApiError};
   * narrow it with {@link isOrderingRefusal} to read `code` and `details`.
   * Other failures: `401 PORTAL_SESSION_INVALID` (a `portalSession` that is
   * unknown, expired or revoked — nothing is placed),
   * `404 ORDERING_LOCATION_NOT_FOUND`,
   * `409 IDEMPOTENCY_KEY_CONFLICT` / `IDEMPOTENCY_CONFLICT` (same key,
   * different body), `409 IDEMPOTENCY_IN_PROGRESS` (wait and send again with
   * the same key), `429 RATE_LIMITED`.
   *
   * ```ts
   * const { data } = await medal.ordering.orders.create(
   *   {
   *     location_id: "loc_1",
   *     channel: "takeaway",
   *     lines: [{ product_id: "p_1", quantity: 2, option_ids: ["o_1"] }],
   *     customer: { name: "Kari", phone: "+4791234567" },
   *     preferences: { cutlery: true },
   *     payment_method: "pay_at_counter",
   *   },
   *   { idempotencyKey: cart.idempotencyKey, clientIp: request.ip },
   * );
   * ```
   *
   * Pass `portalSession` (a customer-portal session token) to place the order
   * for that logged-in customer; it goes out as `X-Portal-Session`. Their
   * cutlery and contactless defaults then apply to preferences left out,
   * their saved allergy note is copied unless
   * `preferences.include_allergy_note` is `false`, and `saved_address_id`
   * picks one of their saved addresses (`422 SAVED_ADDRESS_NOT_FOUND` when it
   * is not on their profile).
   *
   * @throws RangeError before any request for a blank or over-long
   * `idempotencyKey`.
   */
  async create(
    input: OrderingCreateOrderInput,
    options: OrderingCreateOrderOptions,
  ): Promise<OrderCreatedEnvelope> {
    const idempotencyKey =
      typeof options?.idempotencyKey === "string" ? options.idempotencyKey.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new RangeError(
        `ordering.orders.create: idempotencyKey must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters, got ${JSON.stringify(options?.idempotencyKey)}`,
      );
    }
    const clientIp = options.clientIp?.trim();
    const headers: Record<string, string> = {};
    if (clientIp) headers["x-medal-client-ip"] = clientIp;
    // A blank token is a guest order, not a 401.
    const portalSession = options.portalSession?.trim();
    if (portalSession) headers["x-portal-session"] = portalSession;
    return this.client.post<OrderCreatedEnvelope>("/api/v1/ordering/orders", input, {
      idempotencyKey,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal: options.signal,
    });
  }

  /**
   * The guest's order for a receipt or order page: lines with option names
   * and prices, totals, the VAT breakdown and the payment state. No contact
   * details, allergy note or notes. `ready_at` is set while the order is
   * accepted, preparing or ready.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async get(orderId: string, request?: OrderingReadOptions): Promise<CustomerOrderEnvelope> {
    const id = checkPathId("ordering.orders.get", "orderId", orderId);
    return this.client.get<CustomerOrderEnvelope>(
      `/api/v1/ordering/orders/${encodeURIComponent(id)}`,
      undefined,
      { signal: request?.signal },
    );
  }

  /**
   * Poll an order: its status, the promised `ready_at`, a declined order's
   * `decline_reason` and the timeline of status changes.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async status(orderId: string, request?: OrderingReadOptions): Promise<StatusViewEnvelope> {
    const id = checkPathId("ordering.orders.status", "orderId", orderId);
    return this.client.get<StatusViewEnvelope>(
      `/api/v1/ordering/orders/${encodeURIComponent(id)}/status`,
      undefined,
      { signal: request?.signal },
    );
  }

  /**
   * Cancel an order the restaurant has not accepted yet (status `placed`).
   * Repeating it is a no-op that answers `200` again. Once the restaurant has
   * answered it is `409 INVALID_TRANSITION` with `details.status`, the current
   * status — tell the guest to contact the restaurant. Resolves the status view.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async cancel(orderId: string, request?: OrderingReadOptions): Promise<StatusViewEnvelope> {
    const id = checkPathId("ordering.orders.cancel", "orderId", orderId);
    return this.client.post<StatusViewEnvelope>(
      `/api/v1/ordering/orders/${encodeURIComponent(id)}/cancel`,
      undefined,
      { signal: request?.signal },
    );
  }
}

import type { components } from "../openapi.generated";

type Schemas = components["schemas"];

/** The channel a menu is read for. Closed: anything else is a 400. */
export type OrderingChannel = Schemas["OrderingChannel"];

/** The 14 EU-declarable allergens (Regulation 1169/2011, Annex II). */
export type OrderingAllergen = Schemas["OrderingAllergen"];

/** Dietary labels a dish can carry. */
export type OrderingDietary = Schemas["OrderingDietary"];

/** One choice inside a modifier group. `price_delta_ore` is added to the dish price. */
export type OrderingModifierOption = Schemas["OrderingModifierOption"];

/** A group of options on a dish, with how many the guest must/may pick. */
export type OrderingModifierGroup = Schemas["OrderingModifierGroup"];

/**
 * A dish as a guest sees it on one channel. Money is integer øre, VAT
 * included; `vat_bp` is the channel's rate in basis points (1500 = 15 %).
 * `description` and `image_url` are omitted when unset.
 */
export type OrderingMenuItem = Schemas["OrderingMenuItem"];

/** A menu category and the dishes in it. */
export type OrderingMenuCategory = Schemas["OrderingMenuCategory"];

/** The menu for one channel at one instant. `at` is ISO 8601. */
export type OrderingMenu = Schemas["OrderingMenu"];

/**
 * The instant to read the menu at: a `Date`, an ISO 8601 date-time with `Z`
 * or an explicit offset, or Unix milliseconds. The API accepts one day back to
 * 60 days ahead; anything else is a `400 VALIDATION_ERROR`.
 */
export type OrderingInstantInput = Date | string | number;

/** Input for `ordering.menu()`. */
export interface OrderingMenuOptions {
  /** Which channel to read the menu for. */
  channel: OrderingChannel;
  /**
   * Ordering location id from `ordering.locations()`. Dishes and options sold
   * out at that location carry `sold_out: true`; an unknown id is ignored.
   */
  location?: string;
  /**
   * Read the menu as it will be at this instant (a scheduled pickup or
   * delivery time). Defaults to now on the server.
   */
  at?: OrderingInstantInput;
  /**
   * The `etag` of a menu you already hold. When it is still current the call
   * resolves `{ notModified: true }` without downloading the menu again.
   * Opaque — pass back what an earlier call returned; surrounding whitespace is trimmed before it is sent.
   */
  ifNoneMatch?: string;
}

/**
 * What `ordering.menu()` resolves to: either a fresh menu and its ETag, or
 * `notModified: true` when the `ifNoneMatch` you sent is still current — keep
 * using the menu you have.
 */
export type OrderingMenuResult =
  | { notModified: false; etag: string; menu: OrderingMenu }
  | { notModified: true; etag: string };

/** Why a channel is not open right now. */
export type OrderingChannelReason = Schemas["OrderingChannelReason"];

/**
 * One channel of a location, right now: `enabled` (offered at all), `open`
 * (takes orders now) and, when closed, the `reason` and the next `opens_at`.
 * Instants are ISO 8601 UTC; optional fields are omitted, never null.
 */
export type OrderingChannelState = Schemas["OrderingChannelState"];

/** A location's postal address. `region_code` is ISO 3166-1 alpha-2. */
export type OrderingLocationAddress = Schemas["OrderingLocationAddress"];

/** The state of each channel of a location, keyed by channel. */
export type OrderingLocationChannels = Schemas["OrderingLocationChannels"];

/** Which ways a guest can pay at a location. */
export type OrderingPaymentMethods = Schemas["OrderingPaymentMethods"];

/**
 * A location that takes online orders. Pass `id` as `location` to
 * `ordering.slots()`; `preorder_days` (0–7) is how far ahead it can be booked.
 */
export type OrderingLocation = Schemas["OrderingLocation"];

/** Every ordering location, and the workspace's IANA `time_zone`. */
export type OrderingLocations = Schemas["OrderingLocations"];

/** A pickup or delivery slot. `start` and `end` are ISO 8601 UTC. */
export type OrderingSlot = Schemas["OrderingSlot"];

/** The slots of one location, channel and service date. */
export type OrderingSlots = Schemas["OrderingSlots"];

/** Input for `ordering.slots()`. */
export interface OrderingSlotsOptions {
  /** Location id from `ordering.locations()`. */
  location: string;
  /** Which channel to list slots for. */
  channel: OrderingChannel;
  /**
   * Service date, `yyyy-mm-dd`, in the workspace time zone. The API accepts
   * today through today + the location's `preorder_days`; anything else is a
   * `400 VALIDATION_ERROR`.
   */
  date: string;
}

/**
 * Where an order is in its life. A guest-placed order starts `placed`; the
 * restaurant moves it to `accepted` (or `declined`), then `preparing`,
 * `ready` and `handed_over`. Closed.
 */
export type OrderingOrderStatus = Schemas["OrderingOrderStatus"];

/**
 * How the guest pays: `pay_at_counter` (no `return_url`) or `vipps`, which
 * needs a `return_url` on one of the workspace's sites and answers with
 * `status: 'awaiting_payment'` and the `payment.redirect_url` to send the guest to.
 */
export type OrderingPaymentMethod = Schemas["OrderingPaymentMethod"];

/** When the guest wants the order: as soon as possible (the default) or at a scheduled instant. */
export type OrderingOrderTiming = Schemas["OrderingOrderTiming"];

/** One line of a new order: a dish, how many, its chosen option ids and a note. */
export type OrderingOrderLineInput = Schemas["OrderingOrderLineInput"];

/** Who the order is for. `phone` is a Norwegian mobile or E.164. */
export type OrderingOrderCustomer = Schemas["OrderingOrderCustomer"];

/** The guest's preferences. `allergy_note` reaches the kitchen only and is never returned. */
export type OrderingOrderPreferences = Schemas["OrderingOrderPreferences"];

/**
 * The body of `ordering.orders.create()`. Never send a price: every price,
 * VAT rate and name comes from the server menu, and an unknown field is a
 * `400 VALIDATION_ERROR`. Leave optional fields out rather than sending `null`.
 * A `vipps` order needs `return_url` (a page on one of the workspace's sites);
 * `pay_at_counter` takes none.
 */
export type OrderingCreateOrderInput = Omit<
  Schemas["OrderingCreateOrderInput"],
  "payment_method" | "return_url"
> &
  (
    | { payment_method: "pay_at_counter"; return_url?: never }
    | { payment_method: "vipps"; return_url: string }
  );

/** What a placed order answers with: the id to read it by, the number the guest is told, and its status. */
export type OrderingOrderCreated = Schemas["OrderingOrderCreated"];

/** One line of an order as the guest sees it. Money is integer øre, VAT included. */
export type OrderingCustomerOrderLine = Schemas["OrderingCustomerOrderLine"];

/** One VAT rate of an order: `rate_bp` in basis points (1500 = 15 %), net and VAT in øre. */
export type OrderingVatLine = Schemas["OrderingVatLine"];

/** Where the payment of an order stands. */
export type OrderingPaymentState = Schemas["OrderingPaymentState"];

/**
 * The guest's view of an order, for a receipt or order page. It never
 * carries the customer's contact details, the allergy note or any notes.
 * Instants are ISO 8601 UTC; optional fields are omitted, never null.
 */
export type OrderingCustomerOrder = Schemas["OrderingCustomerOrder"];

/** Why the restaurant declined an order; `timeout` means nobody answered in time. */
export type OrderingDeclineReason = Schemas["OrderingDeclineReason"];

/** The status of an order, the promised `ready_at` and the timeline of status changes. */
export type OrderingOrderStatusView = Schemas["OrderingOrderStatusView"];

/** The location and label behind a table QR token. */
export type OrderingTable = Schemas["OrderingTable"];

/**
 * The `422` codes `ordering.orders.create()` refuses an order with. Narrow a
 * caught error with `isOrderingRefusal()` and show your own copy per code;
 * the API's `message` is plain English for logs.
 *
 * - `CLOSED` — the channel is not open; `details.reason` is the channel state reason.
 * - `CUTOFF` — past the last order time.
 * - `CHANNEL_NOT_AVAILABLE` — the channel is not offered (delivery, for now).
 * - `PREORDER_DISABLED` — scheduled timing is not offered (for now).
 * - `TABLE_NOT_FOUND` — dine-in without a valid `table_token` at this location.
 * - `SOLD_OUT`, `UNAVAILABLE` — `details.ids` are the product and option ids.
 * - `INVALID_OPTIONS` — `details.line_index` is the line at fault.
 * - `INVALID_CART` — empty, too many lines, bad quantity or note; `details.line_index` when one line is at fault.
 * - `PAYMENT_METHOD_NOT_ALLOWED` — the location does not take this payment method.
 * - `PAYMENT_UNAVAILABLE` — Vipps: the workspace has no Vipps of its own, or the total is under 1 kr.
 * - `RETURN_URL_NOT_ALLOWED` — Vipps: `return_url` missing or not on one of the workspace's sites.
 * - `INVALID_CUSTOMER` — `details.reason` is `name`, `phone`, `email` or `allergy_note`.
 */
export type OrderingRefusalCode =
  | "CLOSED"
  | "CUTOFF"
  | "CHANNEL_NOT_AVAILABLE"
  | "PREORDER_DISABLED"
  | "TABLE_NOT_FOUND"
  | "SOLD_OUT"
  | "UNAVAILABLE"
  | "INVALID_OPTIONS"
  | "INVALID_CART"
  | "PAYMENT_METHOD_NOT_ALLOWED"
  | "PAYMENT_UNAVAILABLE"
  | "RETURN_URL_NOT_ALLOWED"
  | "INVALID_CUSTOMER";

/**
 * The `details` of an ordering error, as the API sends it (snake_case). Only
 * the fields the code names are present: `ids`, `line_index` and `reason` on a
 * `422` refusal, `status` on a `409 INVALID_TRANSITION` from `cancel()`.
 */
export type OrderingErrorDetails = Schemas["OrderingErrorDetails"];

/** Per-call options for `ordering.orders.create()`. */
export interface OrderingCreateOrderOptions {
  /**
   * Sent as `Idempotency-Key`. Required: mint one per order the guest places
   * (keep it with the cart) and send the same key when retrying, so a lost
   * response never places the order twice. The same key with a different
   * body is `409 IDEMPOTENCY_KEY_CONFLICT`.
   */
  idempotencyKey: string;
  /**
   * The guest's IP address as your server saw it, sent as
   * `X-Medal-Client-Ip`. Optional: it only picks the per-IP rate-limit bucket
   * (10 orders a minute per site and IP). Blank is not sent.
   */
  clientIp?: string;
  /** Your own cancellation signal. */
  signal?: AbortSignal;
}

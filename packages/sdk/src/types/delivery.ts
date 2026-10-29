import type { components } from "../openapi.generated";

type Schemas = components["schemas"];

/**
 * One autocomplete suggestion from `delivery.addresses.suggest()`: `label` is
 * the street address (`Storgata 1`), `secondary` the postcode and town
 * (`0155 Oslo`). `id` is opaque — pass it to `delivery.addresses.resolve()`
 * before quoting.
 */
export type DeliveryAddressSuggestion = Schemas["DeliveryAddressSuggestion"];

/** Where a resolved address's suggestion came from. The address itself is always checked against Kartverket. */
export type DeliveryAddressSource = Schemas["DeliveryResolvedAddress"]["source"];

/**
 * A verified Norwegian address with a house number, from
 * `delivery.addresses.resolve()`. `address_id` is what
 * `delivery.quotes.create()`, `portal.ordering.addresses.add()` and a
 * delivery order's `delivery.verified_address_id` take.
 */
export type DeliveryResolvedAddress = Schemas["DeliveryResolvedAddress"];

/**
 * The body of `delivery.quotes.create()`. Strict: an unknown field is a
 * `400 VALIDATION_ERROR`.
 *
 * - `address_id` (1-64): the resolved address's `address_id`.
 * - `venue_id` (1-64): the pickup place; omitted, the nearest open one.
 * - `bags`: whole number 1-20, default 1.
 * - `prep_minutes`: whole minutes 0-60 until the order is ready; omitted, the
 *   venue's ordering prep time (busy mode included), or 15.
 * - `order_total`: whole øre 0-100 000 000, for free delivery over a
 *   threshold. For an online order it MUST be the cart subtotal — an order
 *   whose subtotal differs refuses the quote (`422 QUOTE_NOT_USABLE`).
 */
export type DeliveryQuoteInput = Schemas["DeliveryQuoteInput"];

/** An amount in integer øre: `{ amount: 4900, currency: "NOK" }` is 49 kr. */
export type DeliveryMoney = Schemas["DeliveryMoney"];

/**
 * A binding Wolt price from `delivery.quotes.create()`.
 *
 * - `customer_fee`: what the store charges its customer (the restaurant's fee
 *   policy applied), `null` when there is none to show.
 * - `cost`: Wolt's price to the restaurant.
 * - `eta_minutes` / `delivered_by`: when the order reaches the customer if
 *   booked now (ISO 8601 UTC) — never a pickup time.
 * - `valid_until`: when the price runs out (ISO 8601 UTC). An order needs at
 *   least one more minute of it (`422 QUOTE_EXPIRED` otherwise).
 * - `address`: the address as Wolt will deliver to it.
 */
export type DeliveryQuote = Schemas["DeliveryQuote"];

/** Per-call options for `delivery.addresses.suggest()` and `delivery.addresses.resolve()`. */
export interface DeliveryAddressOptions {
  /**
   * One token per address the customer enters (a UUID, say), sent to both
   * `suggest` and `resolve` so a Google fallback lookup counts as one
   * session. 8-64 characters of `A-Z a-z 0-9 _ -`.
   */
  session?: string;
  /** Cancel the call — an autocomplete superseded by the next keystroke, say. */
  signal?: AbortSignal;
}

/** Per-call options for `delivery.quotes.create()`. */
export interface DeliveryQuoteOptions {
  /** Cancel the call. The server may still have asked Wolt for the price. */
  signal?: AbortSignal;
}

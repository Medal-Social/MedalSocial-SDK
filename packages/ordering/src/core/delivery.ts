/**
 * Delivery's rules for the browser: the address lookup's session token, when
 * a Wolt quote must be asked for again, the fee it carries, and the door
 * details checked the way the Medal API checks them.
 *
 * The API refuses an order whose quote runs out within a minute
 * (`QUOTE_EXPIRED`) or whose fee band no longer matches the cart's subtotal
 * (`QUOTE_NOT_USABLE`), so a checkout asks again before either: 90 s before
 * `valid_until`, and whenever the subtotal changes.
 */
import type { DeliveryQuote } from '@medalsocial/sdk';

/** The Medal API's limits on a delivery's door details. */
export const DELIVERY_LIMITS = { maxFloor: 20, maxDoorCode: 20, maxComment: 500 } as const;

/** How long before `valid_until` a quote is asked for again: the API's minute and 30 s to spare. */
export const QUOTE_REFRESH_MARGIN_MS = 90_000;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A new address lookup session: 16 random bytes as 22 characters of
 * base64url, which the API's `session` (`^[A-Za-z0-9_-]{8,64}$`) takes. One
 * per address the guest enters, sent to both suggest and resolve.
 */
export function newLookupSession(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL[(value >> bits) & 63];
    }
  }
  return out + BASE64URL[(value << (6 - bits)) & 63];
}

/** When the quote should be asked for again, epoch ms, or `null` without a usable `valid_until`. */
function refreshAt(quote: DeliveryQuote): number | null {
  const until = quote.valid_until === null ? Number.NaN : Date.parse(quote.valid_until);
  return Number.isFinite(until) ? until - QUOTE_REFRESH_MARGIN_MS : null;
}

export interface QuoteFreshness {
  /** The cart's subtotal now, in øre. */
  subtotalOre: number;
  /** The subtotal the quote was asked for with (its `order_total`). */
  quotedSubtotalOre: number;
  /** Epoch ms. Default `Date.now()`. */
  now?: number;
}

/**
 * Whether to ask for a new quote before ordering: within 90 s of
 * `valid_until` (or past it, or without one), or when the cart's subtotal is
 * no longer the one quoted — crossing a free-delivery threshold changes the
 * fee band, which the API refuses as `QUOTE_NOT_USABLE`.
 */
export function quoteNeedsRefresh(quote: DeliveryQuote, freshness: QuoteFreshness): boolean {
  if (freshness.subtotalOre !== freshness.quotedSubtotalOre) return true;
  const at = refreshAt(quote);
  return at === null || (freshness.now ?? Date.now()) >= at;
}

/**
 * Milliseconds until `quoteNeedsRefresh` turns true by the clock alone (`0`
 * when it already has), or `null` when the quote has no `valid_until` to time.
 */
export function quoteRefreshDelay(quote: DeliveryQuote, now = Date.now()): number | null {
  const at = refreshAt(quote);
  return at === null ? null : Math.max(0, at - now);
}

/** What the guest pays for delivery, in øre: the quote's customer fee, `0` when there is none. */
export function deliveryFeeOre(quote: DeliveryQuote): number {
  return quote.customer_fee?.amount ?? 0;
}

/** A delivery's door details, as the guest typed them. */
export interface DeliveryDetails {
  floor?: string;
  door_code?: string;
  comment?: string;
}

/** Which door detail the API would refuse, by its `INVALID_CUSTOMER` reason. */
export type DeliveryField = 'floor' | 'door_code' | 'delivery_comment';

/**
 * The first door detail the Medal API would refuse (`INVALID_CUSTOMER` with
 * this reason), or `null`. Trimmed as the server trims them.
 */
export function checkDelivery(details: DeliveryDetails): DeliveryField | null {
  if ((details.floor?.trim().length ?? 0) > DELIVERY_LIMITS.maxFloor) return 'floor';
  if ((details.door_code?.trim().length ?? 0) > DELIVERY_LIMITS.maxDoorCode) return 'door_code';
  if ((details.comment?.trim().length ?? 0) > DELIVERY_LIMITS.maxComment) {
    return 'delivery_comment';
  }
  return null;
}

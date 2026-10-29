/**
 * What checkout sends, and what can come back: the body the browser posts to
 * the site's own place-order route (the route adds the location and the Vipps
 * return page — the browser never chooses those), the guest's details checked
 * the way the Medal API checks them, and every error code the route answers.
 *
 * The details checks are for telling the guest early; the server checks
 * again and answers `INVALID_CUSTOMER` with the field.
 */
import type {
  OrderingChannel,
  OrderingOrderCustomer,
  OrderingOrderLineInput,
  OrderingOrderPreferences,
  OrderingOrderTiming,
  OrderingPaymentMethod,
  OrderingRefusalCode,
} from '@medalsocial/sdk';

/** The Medal API's limits on the guest's details. */
export const CUSTOMER_LIMITS = { maxName: 80, maxEmail: 254, maxAllergyNote: 200 } as const;

/**
 * The browser's order, as the site's place route takes it. Never a price,
 * never the location or a return URL: the route sets those from its own
 * configuration. The order's idempotency key travels as the
 * `Idempotency-Key` header, from the cart draft.
 */
export interface PlaceOrderRequest {
  /** Pickup or dine-in; delivery needs an address and a quote (plan 8c). */
  channel: Exclude<OrderingChannel, 'delivery'>;
  /** Omitted: as soon as possible. */
  timing?: OrderingOrderTiming;
  /** Dine-in: the token from the table's QR code. */
  table_token?: string;
  lines: OrderingOrderLineInput[];
  customer: OrderingOrderCustomer;
  preferences: OrderingOrderPreferences;
  payment_method: OrderingPaymentMethod;
}

/**
 * Every `error.code` the site's ordering routes answer: the Medal API's
 * refusals of an order, passed through with their `details`, and the routes'
 * own.
 *
 * - `INVALID_REQUEST` — the body or query was not one the route takes.
 * - `ORDER_NOT_FOUND` — no such order (or another workspace's).
 * - `ORDERING_NOT_ENABLED` — the workspace has no online ordering.
 * - `IDEMPOTENCY_IN_PROGRESS` — the same order is still being placed; send it again with the same key.
 * - `IDEMPOTENCY_CONFLICT` — the key was used for another cart; rotate it.
 * - `RATE_LIMITED` — too many orders from this address; wait a minute.
 * - `NOT_CONFIGURED` — the site has no API key or location.
 * - `SERVICE_UNAVAILABLE` — Medal could not be reached; try again.
 */
export type OrderingRouteErrorCode =
  | OrderingRefusalCode
  | 'INVALID_REQUEST'
  | 'ORDER_NOT_FOUND'
  | 'ORDERING_NOT_ENABLED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_CONFIGURED'
  | 'SERVICE_UNAVAILABLE';

/** An error from the site's ordering routes: `{ error: { code, message, details? } }`. */
export interface OrderingRouteError {
  code: OrderingRouteErrorCode;
  /** Fixed English for logs; show the guest `refusalMessage(...)` instead. */
  message: string;
  details?: { ids?: string[]; line_index?: number; reason?: string };
}

/** Which of the guest's details is not one the order endpoint takes. */
export type CustomerField = 'name' | 'phone' | 'email' | 'allergy_note';

const E164 = /^\+[1-9]\d{6,14}$/;
const NORWEGIAN = /^(?:\+47|0047)?\d{8}$/;
// The shape of an address, not a promise it gets mail: one `@`, a dot after it, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A Norwegian number (eight digits, `+47` or `0047` before them allowed) or E.164, spaces and dashes ignored. */
export function isPhoneNumber(value: string): boolean {
  const compact = value.replace(/[\s\-().]/g, '');
  return NORWEGIAN.test(compact) || E164.test(compact);
}

/**
 * The first of the guest's details the Medal API would refuse, in its order
 * (name, phone, e-mail, allergy note), or `null` when they pass. Values are
 * trimmed as the server trims them; an empty e-mail is none.
 */
export function checkCustomer(
  customer: OrderingOrderCustomer,
  allergyNote?: string
): CustomerField | null {
  const name = customer.name.trim();
  if (name.length === 0 || name.length > CUSTOMER_LIMITS.maxName) return 'name';
  if (!isPhoneNumber(customer.phone)) return 'phone';
  const email = customer.email?.trim();
  if (email && (email.length > CUSTOMER_LIMITS.maxEmail || !EMAIL.test(email))) return 'email';
  const note = allergyNote?.trim();
  if (note && note.length > CUSTOMER_LIMITS.maxAllergyNote) return 'allergy_note';
  return null;
}

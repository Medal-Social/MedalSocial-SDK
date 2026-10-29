/** What the ordering route suites share: the secret, fixtures and response readers. */
import type {
  OrderingCustomerOrder,
  OrderingLocations,
  OrderingOrderCreated,
  OrderingOrderStatusView,
  OrderingSlots,
  OrderingTable,
} from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError, MedalTimeoutError } from '@medalsocial/sdk';
import type { PlaceOrderRequest } from '../../src/core/checkout';

/** A placeholder, not a credential: the leak checks look for this exact text. */
export const KEY = 'test-placeholder-api-key-not-a-credential';
export const UPSTREAM = 'https://medal.example.test';
export const SITE = 'https://site.example.test';

export const LOCATIONS = {
  time_zone: 'Europe/Oslo',
  locations: [
    { id: 'loc_1', name: 'Sentrum', preorder_days: 2, slot_minutes: 15 },
    { id: 'loc_2', name: 'Bryggen', preorder_days: 0, slot_minutes: 15 },
  ],
} as unknown as OrderingLocations;

export const SLOTS: OrderingSlots = {
  location_id: 'loc_1',
  channel: 'takeaway',
  date: '2026-10-23',
  time_zone: 'Europe/Oslo',
  slots: [{ start: '2026-10-23T15:00:00Z', end: '2026-10-23T15:15:00Z' }],
};

export const TABLE: OrderingTable = { location_id: 'loc_1', table_label: '12' };

export const CREATED = {
  order_id: 'ord_1',
  order_number: 'P-1021-004',
  status: 'placed',
} as OrderingOrderCreated;

export const STATUS_VIEW = {
  order_id: 'ord_1',
  order_number: 'P-1021-004',
  status: 'accepted',
} as unknown as OrderingOrderStatusView;

export const CUSTOMER_ORDER = {
  order_id: 'ord_1',
  order_number: 'P-1021-004',
  status: 'accepted',
} as unknown as OrderingCustomerOrder;

export const ORDER: PlaceOrderRequest = {
  channel: 'takeaway',
  lines: [{ product_id: 'p_1', quantity: 2, option_ids: ['o_1'] }],
  customer: { name: 'Kari', phone: '+4791234567' },
  preferences: { cutlery: true },
  payment_method: 'pay_at_counter',
};

/** Everything a client can see of a response: status line, headers and body. */
export async function visible(response: Response): Promise<string> {
  const headers = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
  return `${response.status} ${response.statusText}\n${headers}\n\n${await response.text()}`;
}

export interface Body<T> {
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export async function json<T = unknown>(response: Response): Promise<Body<T>> {
  return (await response.json()) as Body<T>;
}

/** Failures that carry the key (and the upstream URL) everywhere they can. */
export function leakyFailures(): unknown[] {
  return [
    new MedalApiError(403, 'ORDERING_NOT_ENABLED', KEY, { key: KEY }),
    new MedalApiError(400, 'VALIDATION_ERROR', KEY, { key: KEY }),
    new MedalApiError(404, 'NOT_FOUND', KEY, { key: KEY }),
    new MedalApiError(409, 'IDEMPOTENCY_IN_PROGRESS', KEY, { key: KEY }),
    new MedalApiError(409, 'IDEMPOTENCY_KEY_CONFLICT', KEY, { key: KEY }),
    new MedalApiError(422, 'SOLD_OUT', KEY, { ids: ['p_1'], reason: 'sold', key: KEY }),
    new MedalApiError(429, 'RATE_LIMITED', KEY, undefined, { retryAfterMs: 2_000 }),
    new MedalApiError(401, 'UNAUTHORIZED', KEY),
    new MedalApiError(502, 'BAD_GATEWAY', `${UPSTREAM} ${KEY}`),
    new MedalNetworkError(KEY, { cause: new Error(KEY) }),
    new MedalTimeoutError(1, KEY),
    new Error(KEY),
    KEY,
  ];
}

/** Assert no secret, upstream URL or stack in anything a client saw. */
export function expectClean(seen: string[]): void {
  for (const text of seen) {
    if (text.includes(KEY)) throw new Error(`key leaked:\n${text}`);
    // A leak check, not a URL check: any occurrence of the upstream origin fails.
    if (text.split(UPSTREAM).length > 1) throw new Error(`upstream leaked:\n${text}`);
    if (text.includes('Bearer')) throw new Error(`auth leaked:\n${text}`);
    if (/\bat .+:\d+:\d+/.test(text)) throw new Error(`stack leaked:\n${text}`);
  }
}

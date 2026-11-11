import type { DeliveryQuote } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  checkDelivery,
  DELIVERY_LIMITS,
  deliveryFeeOre,
  newLookupSession,
  QUOTE_REFRESH_MARGIN_MS,
  quoteNeedsRefresh,
  quoteRefreshDelay,
} from '../../src/core/delivery';

const NOW = Date.parse('2026-10-29T17:00:00Z');

function quote(overrides: Partial<DeliveryQuote> = {}): DeliveryQuote {
  return {
    quote_id: 'q_1',
    customer_fee: { amount: 5900, currency: 'NOK' },
    cost: { amount: 7900, currency: 'NOK' },
    eta_minutes: 35,
    delivered_by: '2026-10-29T17:35:00Z',
    valid_until: '2026-10-29T17:05:00Z',
    address: 'Storgata 1, 0155 Oslo',
    venue_id: 'v_1',
    ...overrides,
  };
}

describe('newLookupSession', () => {
  it('is 22 characters of base64url, the API’s session format, and new each time', () => {
    const sessions = new Set(Array.from({ length: 50 }, newLookupSession));
    expect(sessions.size).toBe(50);
    for (const session of sessions) expect(session).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('maps every byte value into the alphabet', () => {
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(((array: Uint8Array) => array.fill(0xff)) as never);
    expect(newLookupSession()).toBe(`${'_'.repeat(21)}w`);
    spy.mockRestore();
  });
});

describe('quoteNeedsRefresh', () => {
  const same = { subtotalOre: 25_000, quotedSubtotalOre: 25_000, now: NOW };

  it('keeps a quote for the same subtotal more than 90 s from running out', () => {
    expect(quoteNeedsRefresh(quote(), same)).toBe(false);
    const edge = new Date(NOW + QUOTE_REFRESH_MARGIN_MS + 1).toISOString();
    expect(quoteNeedsRefresh(quote({ valid_until: edge }), same)).toBe(false);
  });

  it('refreshes within 90 s of valid_until, or past it', () => {
    expect(QUOTE_REFRESH_MARGIN_MS).toBe(90_000);
    const edge = new Date(NOW + QUOTE_REFRESH_MARGIN_MS).toISOString();
    expect(quoteNeedsRefresh(quote({ valid_until: edge }), same)).toBe(true);
    expect(quoteNeedsRefresh(quote({ valid_until: '2026-10-29T16:00:00Z' }), same)).toBe(true);
  });

  it('keeps a quote without valid_until, or with one that is not a date, for the same subtotal', () => {
    // No stated expiry: no clock to refresh by. A refusal at ordering asks again.
    expect(quoteNeedsRefresh(quote({ valid_until: null }), same)).toBe(false);
    expect(quoteNeedsRefresh(quote({ valid_until: 'soon' }), same)).toBe(false);
    const changed = { ...same, subtotalOre: 25_100 };
    expect(quoteNeedsRefresh(quote({ valid_until: null }), changed)).toBe(true);
    expect(quoteNeedsRefresh(quote({ valid_until: 'soon' }), changed)).toBe(true);
  });

  it('refreshes when the subtotal changed: the fee band may have', () => {
    expect(quoteNeedsRefresh(quote(), { ...same, subtotalOre: 25_100 })).toBe(true);
  });

  it('reads the clock when no now is given', () => {
    vi.useFakeTimers({ now: NOW });
    expect(quoteNeedsRefresh(quote(), { subtotalOre: 1, quotedSubtotalOre: 1 })).toBe(false);
    vi.useRealTimers();
  });
});

describe('quoteRefreshDelay', () => {
  it('is the time until the quote is 90 s from running out, never below 0', () => {
    expect(quoteRefreshDelay(quote(), NOW)).toBe(5 * 60_000 - QUOTE_REFRESH_MARGIN_MS);
    expect(quoteRefreshDelay(quote({ valid_until: '2026-10-29T17:00:30Z' }), NOW)).toBe(0);
  });

  it('is null when there is nothing to time', () => {
    expect(quoteRefreshDelay(quote({ valid_until: null }), NOW)).toBeNull();
    expect(quoteRefreshDelay(quote({ valid_until: 'soon' }), NOW)).toBeNull();
  });

  it('reads the clock when no now is given', () => {
    vi.useFakeTimers({ now: NOW });
    expect(quoteRefreshDelay(quote())).toBe(5 * 60_000 - QUOTE_REFRESH_MARGIN_MS);
    vi.useRealTimers();
  });
});

describe('deliveryFeeOre', () => {
  it('is the customer fee, or 0 when the store charges none', () => {
    expect(deliveryFeeOre(quote())).toBe(5900);
    expect(deliveryFeeOre(quote({ customer_fee: null }))).toBe(0);
    expect(deliveryFeeOre(quote({ customer_fee: { amount: 0, currency: 'NOK' } }))).toBe(0);
  });
});

describe('checkDelivery', () => {
  it('passes details within the API’s limits, trimmed', () => {
    expect(DELIVERY_LIMITS).toEqual({ maxFloor: 20, maxDoorCode: 20, maxComment: 500 });
    expect(checkDelivery({})).toBeNull();
    expect(
      checkDelivery({
        floor: ` ${'x'.repeat(20)} `,
        door_code: '1234',
        comment: 'x'.repeat(500),
      })
    ).toBeNull();
  });

  it('names the first detail the API would refuse, with its reason', () => {
    expect(checkDelivery({ floor: 'x'.repeat(21), door_code: 'x'.repeat(21) })).toBe('floor');
    expect(checkDelivery({ door_code: 'x'.repeat(21), comment: 'x'.repeat(501) })).toBe(
      'door_code'
    );
    expect(checkDelivery({ comment: 'x'.repeat(501) })).toBe('delivery_comment');
  });
});

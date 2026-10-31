import type { OrderingChannelState, OrderingLocation } from '@medalsocial/sdk';

const OPEN: OrderingChannelState = { enabled: true, open: true };

/** A location open for pickup and dine-in, delivery off, both payment methods, two days ahead. */
export function location(overrides: Partial<OrderingLocation> = {}): OrderingLocation {
  return {
    id: 'loc_1',
    name: 'Main',
    address: { lines: ['Street 1'], locality: 'Oslo', postal_code: '0150', region_code: 'NO' },
    channels: {
      takeaway: OPEN,
      dine_in: OPEN,
      delivery: { enabled: false, open: false, reason: 'delivery_off' },
    },
    payment_methods: { vipps: true, pay_at_counter: true },
    preorder_days: 2,
    slot_minutes: 15,
    ...overrides,
  };
}

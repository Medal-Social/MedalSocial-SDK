import type { OrderingOrderStatus } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import {
  isFinalStatus,
  isUnsuccessfulStatus,
  ORDER_STATUS_LABELS,
  ORDER_STEPS,
  orderStatusLabel,
  orderStepIndex,
} from '../../src/core/status';

const ALL = Object.keys(ORDER_STATUS_LABELS) as OrderingOrderStatus[];

describe('order status', () => {
  it('names every status in nb, en and ar', () => {
    expect(ALL).toHaveLength(11);
    expect(orderStatusLabel('ready')).toBe('Klar');
    expect(orderStatusLabel('ready', 'en-GB')).toBe('Ready');
    expect(orderStatusLabel('ready', 'ar')).toBe('جاهز');
    expect(orderStatusLabel('ready', 'de')).toBe('Ready');
  });

  it('stops waiting once handed over or ended', () => {
    expect(ALL.filter(isFinalStatus)).toEqual([
      'handed_over',
      'completed',
      'declined',
      'abandoned',
      'cancelled',
      'refunded',
    ]);
    expect(ALL.filter(isUnsuccessfulStatus)).toEqual([
      'declined',
      'abandoned',
      'cancelled',
      'refunded',
    ]);
  });

  it('places a status on the steps', () => {
    expect(ORDER_STEPS.map(orderStepIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(orderStepIndex('completed')).toBe(ORDER_STEPS.length);
    expect(orderStepIndex('awaiting_payment')).toBe(-1);
    expect(orderStepIndex('declined')).toBe(-1);
  });
});

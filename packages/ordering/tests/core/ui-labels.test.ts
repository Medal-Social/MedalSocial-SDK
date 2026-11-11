import { describe, expect, it } from 'vitest';
import * as core from '../../src/core';
import { fill, mergeLabels, ORDERING_LABELS } from '../../src/core/ui-labels';
import * as react from '../../src/react';

describe('the label packs', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(ORDERING_LABELS.en).sort()).toEqual(Object.keys(ORDERING_LABELS.nb).sort());
  });

  it('picks Norwegian for nb, no and nn, English for the rest, and lays a site’s words over it', () => {
    expect(mergeLabels('nn-NO').close).toBe('Lukk');
    expect(mergeLabels('ar').close).toBe('Close');
    expect(mergeLabels('nb', { close: 'Steng' })).toEqual({
      ...ORDERING_LABELS.nb,
      close: 'Steng',
    });
  });

  it('keeps the pack’s word where an override is undefined', () => {
    const merged = mergeLabels('nb', { opensToday: undefined, close: 'Steng' });
    expect(merged.opensToday).toBe(ORDERING_LABELS.nb.opensToday);
    expect(merged.close).toBe('Steng');
    expect(Object.values(merged)).not.toContain(undefined);
  });

  it('fills placeholders and leaves unknown ones as they are', () => {
    expect(fill('Velg {min} til {max} {x}', { min: 1, max: 2 })).toBe('Velg 1 til 2 {x}');
  });

  it('lives in /core, server-safe, and /react exports only its components', () => {
    expect(core.ORDERING_LABELS).toBe(ORDERING_LABELS);
    expect(core.mergeLabels).toBe(mergeLabels);
    expect(core.fill).toBe(fill);
    expect(Object.keys(react).sort()).toEqual([
      'AddressCombobox',
      'CartBar',
      'CartList',
      'Checkout',
      'ClosedNotice',
      'ItemSheet',
      'MenuList',
      'OrderStatus',
    ]);
  });
});

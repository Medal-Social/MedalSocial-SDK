import type { OrderingModifierGroup } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import {
  linePriceOre,
  selectionMode,
  unitPriceOre,
  validateSelection,
  validateSelections,
} from '../../src/core/modifiers';
import { BURGER, EXTRAS, SAUCE, SIZE } from '../support/menu';

/**
 * Parity with the Medal API's own rules: the cases below are the server
 * suite's, on the wire shape (`min_select`/`max_select`, `sold_out` for an
 * option the server calls inactive). A selection the dish sheet allows must
 * be one the order endpoint accepts, and the other way round.
 */
describe('validateSelection — parity with the server', () => {
  it('selection below min rejected', () => {
    expect(validateSelection(SAUCE, [])).toEqual({ ok: false, reason: 'below_min' });
  });
  it('selection above max rejected', () => {
    expect(validateSelection(SAUCE, ['a', 'b', 'c'])).toEqual({ ok: false, reason: 'above_max' });
  });
  it('inactive (sold-out) option rejected', () => {
    expect(validateSelection(SAUCE, ['x'])).toEqual({ ok: false, reason: 'inactive_option' });
  });
  it('unknown option rejected', () => {
    expect(validateSelection(SAUCE, ['zzz'])).toEqual({ ok: false, reason: 'unknown_option' });
  });
  it('duplicate option rejected', () => {
    expect(validateSelection(SAUCE, ['a', 'a'])).toEqual({ ok: false, reason: 'duplicate_option' });
  });
  it('valid selection ok', () => {
    expect(validateSelection(SAUCE, ['a', 'b'])).toEqual({ ok: true });
  });
});

describe('validateSelection — the order of the checks', () => {
  it('reports a duplicate before an unknown option', () => {
    expect(validateSelection(SAUCE, ['zzz', 'zzz'])).toEqual({
      ok: false,
      reason: 'duplicate_option',
    });
  });
  it('checks each option in turn: unknown or sold out, whichever comes first', () => {
    expect(validateSelection(SAUCE, ['zzz', 'x'])).toEqual({
      ok: false,
      reason: 'unknown_option',
    });
    expect(validateSelection(SAUCE, ['x', 'zzz'])).toEqual({
      ok: false,
      reason: 'inactive_option',
    });
  });
  it('reports a sold-out option before the count', () => {
    expect(validateSelection(SAUCE, ['a', 'b', 'x'])).toEqual({
      ok: false,
      reason: 'inactive_option',
    });
  });
  it('reports below min before above max (a group whose bounds cross)', () => {
    const crossed = { ...SAUCE, min_select: 3, max_select: 1 };
    expect(validateSelection(crossed, ['a', 'b'])).toEqual({ ok: false, reason: 'below_min' });
  });
});

describe('linePriceOre — parity with the server', () => {
  it('line price adds deltas', () => {
    const options = SAUCE.options.filter((o) => o.id === 'a' || o.id === 'c');
    expect(linePriceOre({ price_ore: 12_000 }, options)).toBe(13_500);
  });
  it('is the dish price with no options', () => {
    expect(linePriceOre({ price_ore: 12_000 }, [])).toBe(12_000);
  });
});

describe('validateSelections', () => {
  it('accepts a complete selection', () => {
    expect(validateSelections(BURGER, { size: ['large'], extras: ['cheese'] })).toEqual({
      ok: true,
    });
  });

  it('treats a group missing from the selections as nothing chosen', () => {
    expect(validateSelections(BURGER, { size: ['regular'] })).toEqual({ ok: true });
    expect(validateSelections(BURGER, {})).toEqual({
      ok: false,
      groupId: 'size',
      reason: 'below_min',
    });
  });

  it('reports the first failing group in the dish order', () => {
    expect(validateSelections(BURGER, { extras: ['zzz'], size: [] })).toEqual({
      ok: false,
      groupId: 'size',
      reason: 'below_min',
    });
    expect(validateSelections(BURGER, { size: ['large'], extras: ['bacon', 'bacon'] })).toEqual({
      ok: false,
      groupId: 'extras',
      reason: 'duplicate_option',
    });
  });

  it('refuses a choice in a group the dish does not have', () => {
    expect(validateSelections(BURGER, { size: ['large'], sauce: ['a'] })).toEqual({
      ok: false,
      groupId: 'sauce',
      reason: 'unknown_group',
    });
  });

  it('lets an empty list stand for a group the dish does not have', () => {
    expect(validateSelections(BURGER, { size: ['large'], sauce: [] })).toEqual({ ok: true });
  });

  it('treats a missing list as nothing chosen instead of throwing', () => {
    expect(validateSelection(EXTRAS, undefined)).toEqual({ ok: true });
    expect(validateSelection(SIZE, undefined)).toEqual({ ok: false, reason: 'below_min' });
    expect(validateSelections(BURGER, { size: ['large'], extras: undefined })).toEqual({
      ok: true,
    });
    expect(validateSelections(BURGER, { size: ['large'], sauce: undefined })).toEqual({ ok: true });
    expect(validateSelections(BURGER, { size: undefined })).toEqual({
      ok: false,
      groupId: 'size',
      reason: 'below_min',
    });
  });

  it('accepts a dish without modifiers', () => {
    expect(validateSelections({ ...BURGER, modifier_groups: [] }, {})).toEqual({ ok: true });
  });
});

describe('selectionMode', () => {
  it('is a radio group for exactly one choice and checkboxes otherwise', () => {
    expect(selectionMode(SIZE)).toBe('single');
    const optionalSize: OrderingModifierGroup = { ...SIZE, min_select: 0 };
    expect(selectionMode(optionalSize)).toBe('single');
    expect(selectionMode(SAUCE)).toBe('multi');
    expect(selectionMode(EXTRAS)).toBe('multi');
  });
});

describe('unitPriceOre', () => {
  it('is the dish price plus the chosen options, deltas below zero included', () => {
    expect(unitPriceOre(BURGER, {})).toBe(14_950);
    expect(unitPriceOre(BURGER, { size: ['large'] })).toBe(17_950);
    expect(unitPriceOre(BURGER, { size: ['regular'], extras: ['cheese', 'no-onion'] })).toBe(
      15_950
    );
  });

  it('prices only options the dish has, in their own group', () => {
    expect(unitPriceOre(BURGER, { size: ['cheese'], sauce: ['a'], extras: ['zzz'] })).toBe(14_950);
  });
});

import type { OrderingModifierGroup } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import { type CartLine, checkCart, resolveCart, toOrderLine } from '../../src/core/cart';
import type { DraftLine } from '../../src/core/draft-store';
import { BURGER, MENU, WATER } from '../support/menu';

function draft(
  itemId: string,
  selections: Record<string, string[]> = {},
  extra: Partial<DraftLine> = {}
): DraftLine {
  return {
    lineId: `${itemId}-${Object.values(selections).flat().join('+')}`,
    itemId,
    quantity: 1,
    selections,
    ...extra,
  };
}

describe('resolveCart', () => {
  it('prices the lines the menu can serve', () => {
    const cart = resolveCart(MENU, [
      draft('burger', { size: ['large'], extras: ['cheese'] }, { quantity: 2 }),
      draft('water', {}, { quantity: 3 }),
    ]);
    expect(cart.dropped).toEqual([]);
    expect(cart.lines.map((l) => [l.item.id, l.unitPriceOre, l.totalOre])).toEqual([
      ['burger', 14_950 + 3000 + 1500, (14_950 + 3000 + 1500) * 2],
      ['water', 2500, 7500],
    ]);
    expect(cart.lines[0]?.options.map((o) => o.id)).toEqual(['large', 'cheese']);
    expect(cart.totalOre).toBe((14_950 + 4500) * 2 + 7500);
    expect(cart.count).toBe(5);
  });

  it('sets aside what the menu can no longer serve, saying why', () => {
    const cart = resolveCart(MENU, [
      draft('pizza'),
      draft('soup'),
      draft('fries', { dip: ['chili'] }),
      draft('burger', {}),
      draft('burger', { size: ['regular'], gone: ['x'] }),
      draft('water'),
    ]);
    expect(cart.dropped.map((d) => [d.line.itemId, d.reason, d.item?.id])).toEqual([
      ['pizza', 'unavailable', undefined],
      ['soup', 'sold_out', 'soup'],
      ['fries', 'sold_out', 'fries'],
      ['burger', 'invalid_options', 'burger'],
      ['burger', 'invalid_options', 'burger'],
    ]);
    expect(cart.lines.map((l) => l.item.id)).toEqual(['water']);
    expect(cart.totalOre).toBe(2500);
    expect(cart.count).toBe(1);
  });

  it('refuses a line whose price goes below zero', () => {
    const cheap = {
      ...WATER,
      id: 'cheap',
      price_ore: 100,
      modifier_groups: [BURGER.modifier_groups[1] as OrderingModifierGroup],
    };
    const menu = { categories: [{ id: 'c', name: 'c', items: [cheap] }] };
    const cart = resolveCart(menu, [draft('cheap', { extras: ['no-onion'] })]);
    expect(cart.dropped.map((d) => d.reason)).toEqual(['invalid_options']);
  });

  it('is empty for an empty draft', () => {
    expect(resolveCart(MENU, [])).toEqual({ lines: [], dropped: [], totalOre: 0, count: 0 });
  });
});

describe('toOrderLine', () => {
  it('sends the ids flat, in the dish group order, and the note when there is one', () => {
    const [line] = resolveCart(MENU, [
      draft('burger', { extras: ['bacon'], size: ['large'] }, { quantity: 2, note: 'No salt' }),
    ]).lines;
    expect(toOrderLine(line as CartLine)).toEqual({
      product_id: 'burger',
      quantity: 2,
      option_ids: ['large', 'bacon'],
      note: 'No salt',
    });
    const [water] = resolveCart(MENU, [draft('water')]).lines;
    expect(toOrderLine(water as CartLine)).toEqual({
      product_id: 'water',
      quantity: 1,
      option_ids: [],
    });
  });

  it('builds lines checkCart accepts at the same total', () => {
    const cart = resolveCart(MENU, [
      draft('burger', { size: ['regular'], extras: ['no-onion'] }),
      draft('fries', { dip: ['garlic'] }, { quantity: 2 }),
    ]);
    const check = checkCart(MENU, cart.lines.map(toOrderLine));
    expect(check).toEqual({
      ok: true,
      totalOre: cart.totalOre,
      lineTotalsOre: cart.lines.map((l) => l.totalOre),
    });
  });
});

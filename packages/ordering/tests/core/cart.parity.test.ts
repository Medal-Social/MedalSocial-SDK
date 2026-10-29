/**
 * The package's cart check answers exactly as the Medal API's own pricing.
 *
 * tests/fixtures/cart.json holds a wire menu, a table of carts and what the
 * API's `priceCart` answered for each, written by
 * `scripts/export-cart-fixtures.mjs --engine <the API's cart.ts>`. Every cart
 * runs here through `checkCart`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrderingMenu, OrderingOrderLineInput } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import { type CartCheck, checkCart } from '../../src/core/cart';

const fixture: {
  menu: OrderingMenu;
  cases: Array<{ name: string; lines: OrderingOrderLineInput[]; result: CartCheck }>;
} = JSON.parse(readFileSync(join(__dirname, '../fixtures/cart.json'), 'utf8'));

describe('cart check parity with the Medal API', () => {
  it('has both answers in the table', () => {
    expect(fixture.cases.some((c) => c.result.ok)).toBe(true);
    expect(new Set(fixture.cases.map((c) => (c.result.ok ? 'OK' : c.result.code)))).toEqual(
      new Set(['OK', 'INVALID_CART', 'UNAVAILABLE', 'SOLD_OUT', 'INVALID_OPTIONS'])
    );
  });

  it.each(fixture.cases.map((c, i) => [`${i} ${c.name}`, c] as const))('%s', (_label, c) => {
    expect(checkCart(fixture.menu, c.lines)).toStrictEqual(c.result);
  });
});

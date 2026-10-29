#!/usr/bin/env node
// Writes tests/fixtures/cart.json: a wire menu, a table of carts, and what the
// Medal API's own cart pricing (`priceCart`) answers for each, so
// tests/core/cart.parity.test.ts can hold the package's `checkCart` to it.
//
//   node scripts/export-cart-fixtures.mjs --engine <monorepo>/apps/shared/ordering/cart.ts
//
// esbuild bundles the engine (types stripped, its relative imports inlined)
// into one module, which is then imported. The menu is written in the wire
// shape the package reads (snake_case, as `GET /api/v1/ordering/menu` sends
// it) and handed to the engine in its own shape. The engine's answer is
// written as `checkCart` answers: the total and each line's total for a cart
// it prices, the code and its `ids`/`lineIndex` for one it refuses.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { engine: { type: 'string' }, out: { type: 'string' } },
});
if (!values.engine) {
  console.error('usage: export-cart-fixtures.mjs --engine <path to cart.ts> [--out <file>]');
  process.exit(1);
}
const out = resolve(values.out ?? join(root, 'tests/fixtures/cart.json'));

// --- The menu ----------------------------------------------------------------

/** @typedef {{ id: string, name: string, price_delta_ore: number, allergens: string[], vat_bp: number, sold_out: boolean }} WireOption */
/** @typedef {{ id: string, name: string, min_select: number, max_select: number, options: WireOption[] }} WireGroup */
/** @typedef {{ id: string, name: string, price_ore: number, vat_bp: number, allergens: string[], dietary: string[], sold_out: boolean, modifier_groups: WireGroup[] }} WireItem */
/** @typedef {{ categories: { id: string, name: string, items: WireItem[] }[], etag: string, channel: string, at: string }} WireMenu */
/** @typedef {{ product_id: string, quantity: number, option_ids?: string[], note?: string }} WireLine */
/** @typedef {{ soldOut?: boolean, vatBp?: number }} Extra */

/** @param {string} id @param {number} priceDeltaOre @param {Extra} [extra] @returns {WireOption} */
function option(id, priceDeltaOre, extra = {}) {
  return {
    id,
    name: id,
    price_delta_ore: priceDeltaOre,
    allergens: [],
    vat_bp: extra.vatBp ?? 1500,
    sold_out: extra.soldOut ?? false,
  };
}

/** @param {string} id @param {number} priceOre @param {WireGroup[]} groups @param {Extra} [extra] @returns {WireItem} */
function item(id, priceOre, groups, extra = {}) {
  return {
    id,
    name: id,
    price_ore: priceOre,
    vat_bp: extra.vatBp ?? 1500,
    allergens: [],
    dietary: [],
    sold_out: extra.soldOut ?? false,
    modifier_groups: groups,
  };
}

/** @param {string} id @param {number} min @param {number} max @param {WireOption[]} options @returns {WireGroup} */
function group(id, min, max, options) {
  return { id, name: id, min_select: min, max_select: max, options };
}

const SIZE = group('size', 1, 1, [option('regular', 0), option('large', 3000)]);
const EXTRAS = group('extras', 0, 3, [
  option('cheese', 1500),
  option('bacon', 2000),
  option('no-onion', -500),
  option('truffle', 4000, { soldOut: true }),
]);
const SAUCE = group('sauce', 1, 2, [
  option('mayo', 0),
  option('chili', 500),
  option('aioli', 1000),
]);
const DISCOUNT = group('discount', 0, 1, [option('half', -6000)]);
// The same option id in two groups of one dish: the server cannot tell which is meant.
const LEFT = group('left', 0, 1, [option('twin', 100)]);
const RIGHT = group('right', 0, 1, [option('twin', 200)]);

const MENU = {
  categories: [
    {
      id: 'mains',
      name: 'Mains',
      items: [
        item('burger', 14950, [SIZE, EXTRAS]),
        item('wrap', 11900, [SAUCE]),
        item('soup', 9900, [], { soldOut: true }),
        item('kids', 5000, [DISCOUNT]),
        item('twins', 1000, [LEFT, RIGHT]),
      ],
    },
    { id: 'empty', name: 'Empty', items: [] },
    {
      id: 'drinks',
      name: 'Drinks',
      items: [item('water', 2500, [], { vatBp: 2500 }), item('cola', 3900, [], { vatBp: 2500 })],
    },
  ],
  etag: 'fixture',
  channel: 'takeaway',
  at: '2026-10-29T12:00:00.000Z',
};

/** The wire menu in the engine's own shape. @param {WireMenu} menu */
function engineMenu(menu) {
  return {
    etag: menu.etag,
    categories: menu.categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((i) => ({
        id: i.id,
        name: i.name,
        priceOre: i.price_ore,
        vatBp: i.vat_bp,
        allergens: i.allergens,
        dietary: i.dietary,
        soldOut: i.sold_out,
        modifierGroups: i.modifier_groups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.min_select,
          maxSelect: g.max_select,
          options: g.options.map((o) => ({
            id: o.id,
            name: o.name,
            priceDeltaOre: o.price_delta_ore,
            allergens: o.allergens,
            vatBp: o.vat_bp,
            soldOut: o.sold_out,
          })),
        })),
      })),
    })),
  };
}

// --- The carts ----------------------------------------------------------------

/** @type {{ name: string, lines: WireLine[] }[]} */
const cases = [];
/** @type {(product_id: string, quantity: number, option_ids?: string[], note?: string) => WireLine} */
const line = (product_id, quantity, option_ids, note) => ({
  product_id,
  quantity,
  ...(option_ids === undefined ? {} : { option_ids }),
  ...(note === undefined ? {} : { note }),
});
/** @type {(name: string, lines: WireLine[]) => void} */
const add = (name, lines) => cases.push({ name, lines });

add('one plain dish', [line('water', 1)]);
add('quantity multiplies', [line('cola', 3)]);
add('required choice made', [line('burger', 1, ['regular'])]);
add('options add to the price', [line('burger', 2, ['large', 'cheese', 'bacon'])]);
add('an option that takes away', [line('burger', 1, ['regular', 'no-onion'])]);
add('several lines, two rates', [
  line('burger', 1, ['large']),
  line('wrap', 2, ['mayo', 'chili']),
  line('water', 4),
]);
add('option ids in any order', [line('burger', 1, ['bacon', 'large', 'cheese'])]);
add('option_ids left out', [line('water', 2)]);
add('a note within the limit', [line('water', 1, [], 'x'.repeat(200))]);
add('the same dish on two lines', [line('cola', 1), line('cola', 2)]);
add('a discount down to zero is fine', [line('kids', 1, [])]);

add('empty cart', []);
add(
  'too many lines',
  Array.from({ length: 51 }, () => line('water', 1))
);
add(
  'fifty lines is the limit',
  Array.from({ length: 50 }, () => line('water', 1))
);
add('quantity zero', [line('water', 1), line('water', 0)]);
add('quantity over the limit', [line('water', 100)]);
add('quantity at the limit', [line('water', 99)]);
add('quantity not whole', [line('water', 1.5)]);
add('note too long', [line('water', 1, [], 'x'.repeat(201))]);

add('unknown dish', [line('pizza', 1)]);
add('unknown option', [line('burger', 1, ['regular', 'ketchup'])]);
add('every unknown id at once', [line('pizza', 1), line('burger', 1, ['regular', 'ketchup'])]);
add('sold-out dish', [line('soup', 1)]);
add('sold-out option', [line('burger', 1, ['regular', 'truffle'])]);
add('unknown before sold out', [line('soup', 1), line('pizza', 1)]);
add('sold out before options', [line('burger', 1, []), line('soup', 1)]);

add('required choice missing', [line('water', 1), line('burger', 1, [])]);
add('too many in a group', [line('burger', 1, ['regular', 'large'])]);
add('too many extras', [line('burger', 1, ['regular', 'cheese', 'bacon', 'no-onion', 'cheese'])]);
add('the same option twice', [line('wrap', 1, ['mayo', 'mayo'])]);
add('wrap with two sauces', [line('wrap', 1, ['mayo', 'aioli'])]);
add('wrap with three sauces', [line('wrap', 1, ['mayo', 'chili', 'aioli'])]);
add('an option id in two groups', [line('twins', 1, ['twin'])]);
add('below zero', [line('kids', 1, ['half'])]);
add('below zero after a good line', [line('water', 1), line('kids', 2, ['half'])]);

// --- Run the engine ---------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'cart-fixtures-'));
try {
  const bundle = join(dir, 'engine.mjs');
  await build({
    entryPoints: [resolve(values.engine)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    logLevel: 'error',
  });
  const { priceCart } = await import(pathToFileURL(bundle).href);
  const menu = engineMenu(MENU);
  const table = cases.map(({ name, lines }) => {
    const priced = priceCart(
      menu,
      lines.map((/** @type {WireLine} */ l) => ({
        productId: l.product_id,
        quantity: l.quantity,
        optionIds: l.option_ids ?? [],
        ...(l.note === undefined ? {} : { note: l.note }),
      })),
      'takeaway'
    );
    let result;
    if (priced.ok) {
      const lineTotalsOre = priced.lines.map(
        (
          /** @type {{ unitPriceOre: number, quantity: number, options: { priceDeltaOre: number }[] }} */ l
        ) => (l.unitPriceOre + l.options.reduce((sum, o) => sum + o.priceDeltaOre, 0)) * l.quantity
      );
      result = { ok: true, totalOre: priced.totalOre, lineTotalsOre };
    } else {
      result = priced;
    }
    return { name, lines, result };
  });
  writeFileSync(out, `${JSON.stringify({ menu: MENU, cases: table }, null, 2)}\n`);
  console.log(`wrote ${table.length} cases to ${out}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

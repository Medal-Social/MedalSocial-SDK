/**
 * The cart against the menu: what the guest has chosen, priced for their eyes,
 * and the order lines the site sends.
 *
 * `checkCart` is the Medal API's own cart check (`priceCart`), on the wire
 * shape: the same limits, the same refusal codes in the same order, and the
 * same total. A cart it accepts is one the order endpoint prices to the same
 * øre, unless the menu changes in between — the server prices the order again
 * regardless. It stops at the total: the VAT breakdown is the server's (an
 * option that is a product of its own is taxed apart there, and the wire menu
 * does not say which options are), so a receipt reads it from the order.
 * `tests/core/cart.parity.test.ts` holds it to the server through
 * `tests/fixtures/cart.json`.
 *
 * `resolveCart` is the page's view of the draft: each line with its dish, its
 * options and its price, and the lines the menu can no longer serve listed
 * apart, so the page can say what was taken out instead of failing the order.
 */
import type {
  OrderingMenu,
  OrderingMenuItem,
  OrderingModifierOption,
  OrderingOrderLineInput,
} from '@medalsocial/sdk';
import type { DraftLine } from './draft-store';
import { linePriceOre, validateSelection, validateSelections } from './modifiers';

/** The order endpoint's limits on a cart: lines, quantity per line, note length. */
export const CART_LIMITS = { maxLines: 50, maxQuantity: 99, maxNoteLength: 200 } as const;

export type CartCheck =
  | { ok: true; totalOre: number; lineTotalsOre: number[] }
  | { ok: false; code: 'SOLD_OUT' | 'UNAVAILABLE'; ids: string[] }
  | { ok: false; code: 'INVALID_OPTIONS'; lineIndex: number }
  | { ok: false; code: 'INVALID_CART'; lineIndex?: number };

/** Every dish on the menu by id. */
function itemsById(menu: Pick<OrderingMenu, 'categories'>): Map<string, OrderingMenuItem> {
  const items = new Map<string, OrderingMenuItem>();
  for (const category of menu.categories) {
    for (const item of category.items) items.set(item.id, item);
  }
  return items;
}

function guard(lines: readonly OrderingOrderLineInput[]): CartCheck | undefined {
  if (lines.length === 0 || lines.length > CART_LIMITS.maxLines) {
    return { ok: false, code: 'INVALID_CART' };
  }
  for (const [lineIndex, line] of lines.entries()) {
    const badQuantity =
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > CART_LIMITS.maxQuantity;
    const badNote = line.note !== undefined && line.note.length > CART_LIMITS.maxNoteLength;
    if (badQuantity || badNote) return { ok: false, code: 'INVALID_CART', lineIndex };
  }
  return undefined;
}

interface Resolved {
  item: OrderingMenuItem;
  picks: Map<string, string[]>;
  /** An option id in more than one of the dish's groups cannot be placed. */
  ambiguous: boolean;
}

/**
 * The server's `priceCart`, totals only. Checked in its order: the cart's
 * shape, then every unknown id (`UNAVAILABLE`, all of them), then every
 * sold-out id (`SOLD_OUT`), then line by line the options (`INVALID_OPTIONS`).
 */
export function checkCart(
  menu: Pick<OrderingMenu, 'categories'>,
  lines: readonly OrderingOrderLineInput[]
): CartCheck {
  const refused = guard(lines);
  if (refused) return refused;

  const items = itemsById(menu);
  const unavailable = new Set<string>();
  const soldOut = new Set<string>();
  const resolved: Resolved[] = [];
  for (const line of lines) {
    const item = items.get(line.product_id);
    if (!item) {
      unavailable.add(line.product_id);
      continue;
    }
    if (item.sold_out) soldOut.add(item.id);
    const picks = new Map<string, string[]>();
    let ambiguous = false;
    for (const optionId of line.option_ids ?? []) {
      const owners = item.modifier_groups.filter((group) =>
        group.options.some((option) => option.id === optionId)
      );
      const group = owners[0];
      if (owners.length > 1) ambiguous = true;
      if (!group) {
        unavailable.add(optionId);
        continue;
      }
      if (group.options.find((option) => option.id === optionId)?.sold_out) soldOut.add(optionId);
      picks.set(group.id, [...(picks.get(group.id) ?? []), optionId]);
    }
    resolved.push({ item, picks, ambiguous });
  }
  if (unavailable.size > 0) return { ok: false, code: 'UNAVAILABLE', ids: [...unavailable] };
  if (soldOut.size > 0) return { ok: false, code: 'SOLD_OUT', ids: [...soldOut] };

  let totalOre = 0;
  const lineTotalsOre: number[] = [];
  for (const [lineIndex, { item, picks, ambiguous }] of resolved.entries()) {
    if (ambiguous) return { ok: false, code: 'INVALID_OPTIONS', lineIndex };
    const chosen: OrderingModifierOption[] = [];
    for (const group of item.modifier_groups) {
      const optionIds = picks.get(group.id) ?? [];
      // Sold-out options were refused above; the server checks these as active.
      const result = validateSelection(
        { ...group, options: group.options.map((option) => ({ ...option, sold_out: false })) },
        optionIds
      );
      if (!result.ok) return { ok: false, code: 'INVALID_OPTIONS', lineIndex };
      for (const optionId of optionIds) {
        chosen.push(
          group.options.find((option) => option.id === optionId) as OrderingModifierOption
        );
      }
    }
    const lineTotal =
      linePriceOre(item, chosen) * (lines[lineIndex] as OrderingOrderLineInput).quantity;
    if (lineTotal < 0) return { ok: false, code: 'INVALID_OPTIONS', lineIndex };
    lineTotalsOre.push(lineTotal);
    totalOre += lineTotal;
  }
  return { ok: true, totalOre, lineTotalsOre };
}

/**
 * A priced cart line as the order endpoint takes it: the dish, the quantity,
 * the option ids flat (in the dish's group order) and the note when there is one.
 */
export function toOrderLine(
  cartLine: Pick<CartLine, 'line' | 'item' | 'options'>
): OrderingOrderLineInput {
  return {
    product_id: cartLine.item.id,
    quantity: cartLine.line.quantity,
    option_ids: cartLine.options.map((option) => option.id),
    ...(cartLine.line.note ? { note: cartLine.line.note } : {}),
  };
}

/** A draft line the menu can serve, priced. */
export interface CartLine {
  line: DraftLine;
  item: OrderingMenuItem;
  /** The chosen options, in the dish's group order. */
  options: OrderingModifierOption[];
  /** One of the dish with its options, øre. */
  unitPriceOre: number;
  /** `unitPriceOre` × quantity. */
  totalOre: number;
}

/**
 * Why a draft line was set aside: the dish is gone from this menu
 * (`unavailable`), it or a chosen option is sold out (`sold_out`), or its
 * choices no longer fit the dish's groups (`invalid_options`).
 */
export type DroppedReason = 'unavailable' | 'sold_out' | 'invalid_options';

export interface DroppedLine {
  line: DraftLine;
  /** The dish, when the menu still has it — for its name. */
  item?: OrderingMenuItem;
  reason: DroppedReason;
}

export interface ResolvedCart {
  lines: CartLine[];
  dropped: DroppedLine[];
  /** The sum of the lines the menu can serve, øre. What the guest pays may differ by a menu change; the server prices the order. */
  totalOre: number;
  /** How many dishes, quantities added up. */
  count: number;
}

/** The draft against the menu: priced lines, and the lines it can no longer serve. */
export function resolveCart(
  menu: Pick<OrderingMenu, 'categories'>,
  draftLines: readonly DraftLine[]
): ResolvedCart {
  const items = itemsById(menu);
  const lines: CartLine[] = [];
  const dropped: DroppedLine[] = [];
  for (const line of draftLines) {
    const item = items.get(line.itemId);
    if (!item) {
      dropped.push({ line, reason: 'unavailable' });
      continue;
    }
    const options = item.modifier_groups.flatMap((group) => {
      const ids = line.selections[group.id] ?? [];
      return group.options.filter((option) => ids.includes(option.id));
    });
    const check = validateSelections(item, line.selections);
    if (item.sold_out || (!check.ok && check.reason === 'inactive_option')) {
      dropped.push({ line, item, reason: 'sold_out' });
      continue;
    }
    const unitPriceOre = linePriceOre(item, options);
    if (!check.ok || unitPriceOre < 0) {
      dropped.push({ line, item, reason: 'invalid_options' });
      continue;
    }
    lines.push({ line, item, options, unitPriceOre, totalOre: unitPriceOre * line.quantity });
  }
  return {
    lines,
    dropped,
    totalOre: lines.reduce((sum, l) => sum + l.totalOre, 0),
    count: lines.reduce((sum, l) => sum + l.line.quantity, 0),
  };
}

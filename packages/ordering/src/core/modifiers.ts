/**
 * The modifier rules a dish sheet applies before a line goes in the cart.
 *
 * These are the Medal API's own rules, in the same order and with the same
 * reason names, read on the wire shape: `min_select`/`max_select`, and an
 * option the server calls inactive is one the guest sees as `sold_out`. A
 * selection the sheet allows is one the order endpoint accepts; the server
 * checks again regardless, so this is for telling the guest early, not a
 * gate. Prices are per unit — cart totals and VAT are the server's.
 */
import type {
  OrderingMenuItem,
  OrderingModifierGroup,
  OrderingModifierOption,
} from '@medalsocial/sdk';

export type SelectionFailure =
  | 'below_min'
  | 'above_max'
  | 'unknown_option'
  | 'inactive_option'
  | 'duplicate_option';

export type SelectionResult = { ok: true } | { ok: false; reason: SelectionFailure };

/**
 * The guest's choices on one dish: option ids per modifier group id. A group
 * missing, or `undefined`, is nothing chosen.
 */
export type Selections = Readonly<Record<string, readonly string[] | undefined>>;

export type SelectionsResult =
  | { ok: true }
  | { ok: false; groupId: string; reason: SelectionFailure | 'unknown_group' };

/**
 * One group's choice. Checked in this order: a repeated option, an option the
 * group does not have, a sold-out option, too few, too many. A missing list
 * is nothing chosen.
 */
export function validateSelection(
  group: Pick<OrderingModifierGroup, 'min_select' | 'max_select' | 'options'>,
  chosen: readonly string[] | undefined
): SelectionResult {
  const optionIds = chosen ?? [];
  if (new Set(optionIds).size !== optionIds.length)
    return { ok: false, reason: 'duplicate_option' };
  for (const id of optionIds) {
    const option = group.options.find((o) => o.id === id);
    if (!option) return { ok: false, reason: 'unknown_option' };
    if (option.sold_out) return { ok: false, reason: 'inactive_option' };
  }
  if (optionIds.length < group.min_select) return { ok: false, reason: 'below_min' };
  if (optionIds.length > group.max_select) return { ok: false, reason: 'above_max' };
  return { ok: true };
}

/** The dish price plus each option's difference, in øre. */
export function linePriceOre(
  item: Pick<OrderingMenuItem, 'price_ore'>,
  options: readonly Pick<OrderingModifierOption, 'price_delta_ore'>[]
): number {
  return options.reduce((sum, o) => sum + o.price_delta_ore, item.price_ore);
}

/**
 * Every group on a dish, in the dish's order; a group missing from
 * `selections` is nothing chosen. Reports the first group that fails. A
 * choice in a group the dish does not have (a stale cart line) is
 * `unknown_group`; an empty list there is harmless.
 */
export function validateSelections(
  item: Pick<OrderingMenuItem, 'modifier_groups'>,
  selections: Selections
): SelectionsResult {
  for (const group of item.modifier_groups) {
    const result = validateSelection(group, selections[group.id]);
    if (!result.ok) return { ok: false, groupId: group.id, reason: result.reason };
  }
  for (const [groupId, optionIds] of Object.entries(selections)) {
    if (
      optionIds !== undefined &&
      optionIds.length > 0 &&
      !item.modifier_groups.some((group) => group.id === groupId)
    )
      return { ok: false, groupId, reason: 'unknown_group' };
  }
  return { ok: true };
}

/** A radio group (`'single'`) when exactly one may be chosen, checkboxes (`'multi'`) otherwise. */
export function selectionMode(
  group: Pick<OrderingModifierGroup, 'max_select'>
): 'single' | 'multi' {
  return group.max_select === 1 ? 'single' : 'multi';
}

/**
 * The price of one of this dish with these choices — what the dish sheet
 * shows. Only options the dish has, in their own group, count; whether the
 * choice is allowed is `validateSelections`'s question.
 */
export function unitPriceOre(
  item: Pick<OrderingMenuItem, 'price_ore' | 'modifier_groups'>,
  selections: Selections
): number {
  const chosen = item.modifier_groups.flatMap((group) => {
    const ids = selections[group.id] ?? [];
    return group.options.filter((option) => ids.includes(option.id));
  });
  return linePriceOre(item, chosen);
}

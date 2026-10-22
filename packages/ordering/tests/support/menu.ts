import type {
  OrderingAllergen,
  OrderingMenuItem,
  OrderingModifierGroup,
  OrderingModifierOption,
} from '@medalsocial/sdk';

function option(
  id: string,
  priceDeltaOre: number,
  extra: { soldOut?: boolean; allergens?: OrderingAllergen[] } = {}
): OrderingModifierOption {
  return {
    id,
    name: id,
    price_delta_ore: priceDeltaOre,
    allergens: extra.allergens ?? [],
    vat_bp: 1500,
    sold_out: extra.soldOut ?? false,
  };
}

/** The server suite's group, on the wire: one or two of a, b, c; x is sold out. */
export const SAUCE: OrderingModifierGroup = {
  id: 'sauce',
  name: 'Sauce',
  min_select: 1,
  max_select: 2,
  options: [option('a', 1000), option('b', 0), option('c', 500), option('x', 0, { soldOut: true })],
};

/** Optional extras, any number up to three; one takes something away. */
export const EXTRAS: OrderingModifierGroup = {
  id: 'extras',
  name: 'Extras',
  min_select: 0,
  max_select: 3,
  options: [
    option('cheese', 1500, { allergens: ['milk'] }),
    option('bacon', 2000),
    option('no-onion', -500),
  ],
};

/** Exactly one size. */
export const SIZE: OrderingModifierGroup = {
  id: 'size',
  name: 'Size',
  min_select: 1,
  max_select: 1,
  options: [option('regular', 0), option('large', 3000)],
};

export const BURGER: OrderingMenuItem = {
  id: 'burger',
  name: 'Burger',
  price_ore: 14_950,
  vat_bp: 1500,
  allergens: ['gluten'],
  dietary: [],
  sold_out: false,
  modifier_groups: [SIZE, EXTRAS],
};

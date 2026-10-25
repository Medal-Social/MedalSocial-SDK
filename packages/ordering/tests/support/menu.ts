import type {
  OrderingAllergen,
  OrderingMenu,
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

/** Optional: no sauce, or one. */
export const DIP: OrderingModifierGroup = {
  id: 'dip',
  name: 'Dip',
  min_select: 0,
  max_select: 1,
  options: [option('garlic', 1000), option('chili', 1000, { soldOut: true })],
};

export const FRIES: OrderingMenuItem = {
  id: 'fries',
  name: 'Fries',
  description: 'Crisp and salted.',
  price_ore: 4_900,
  vat_bp: 1500,
  image_url: 'https://example.com/fries.jpg',
  allergens: ['celery', 'mustard'],
  dietary: ['vegan', 'gluten_free'],
  sold_out: false,
  modifier_groups: [DIP],
};

export const SOUP: OrderingMenuItem = {
  id: 'soup',
  name: 'Soup',
  price_ore: 9_900,
  vat_bp: 1500,
  allergens: [],
  dietary: [],
  sold_out: true,
  modifier_groups: [],
};

/** A dish with nothing to choose. */
export const WATER: OrderingMenuItem = {
  id: 'water',
  name: 'Water',
  price_ore: 2_500,
  vat_bp: 2500,
  allergens: [],
  dietary: [],
  sold_out: false,
  modifier_groups: [],
};

export const MENU: OrderingMenu = {
  categories: [
    { id: 'mains', name: 'Mains', items: [BURGER, SOUP] },
    { id: 'empty', name: 'Nothing here', items: [] },
    { id: 'sides', name: 'Sides', items: [FRIES, WATER] },
  ],
  etag: 'v1',
  channel: 'takeaway',
  at: '2026-10-22T10:00:00.000Z',
};

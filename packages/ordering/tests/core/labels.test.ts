import type { OrderingAllergen, OrderingDietary } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import {
  ALLERGEN_LABELS,
  allergenLabel,
  DIETARY_LABELS,
  deliveryWindowLabel,
  dietaryLabel,
  labelLocale,
} from '../../src/core/labels';

const ALLERGENS: OrderingAllergen[] = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
];
const DIETARY: OrderingDietary[] = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'lactose_free',
  'halal',
  'spicy',
];

describe('labels', () => {
  it('names the 14 declarable allergens and every dietary label in nb, en and ar', () => {
    expect(Object.keys(ALLERGEN_LABELS).sort()).toEqual([...ALLERGENS].sort());
    expect(Object.keys(DIETARY_LABELS).sort()).toEqual([...DIETARY].sort());
    for (const pack of [...Object.values(ALLERGEN_LABELS), ...Object.values(DIETARY_LABELS)]) {
      expect(Object.keys(pack).sort()).toEqual(['ar', 'en', 'nb']);
      for (const text of Object.values(pack)) expect(text.trim()).not.toBe('');
    }
  });

  it('carries the server labels', () => {
    expect(ALLERGEN_LABELS.sulphites).toEqual({
      nb: 'Svoveldioksid og sulfitter',
      en: 'Sulphites',
      ar: 'الكبريتيت',
    });
    expect(ALLERGEN_LABELS.nuts.en).toBe('Tree nuts');
    expect(DIETARY_LABELS.gluten_free).toEqual({
      nb: 'Glutenfri',
      en: 'Gluten-free',
      ar: 'خالٍ من الغلوتين',
    });
    expect(DIETARY_LABELS.spicy.nb).toBe('Sterk');
  });

  it.each([
    ['nb-NO', 'nb'],
    ['no', 'nb'],
    ['nn', 'nb'],
    ['NB', 'nb'],
    ['ar', 'ar'],
    ['ar-SA', 'ar'],
    ['en-GB', 'en'],
    ['sv-SE', 'en'],
    ['', 'en'],
  ])('reads the locale %j as the %s pack', (locale, expected) => {
    expect(labelLocale(locale)).toBe(expected);
  });

  it('labels an allergen or a dietary mark for a locale', () => {
    expect(allergenLabel('milk', 'nb-NO')).toBe('Melk');
    expect(allergenLabel('milk', 'en')).toBe('Milk');
    expect(allergenLabel('milk', 'ar')).toBe('الحليب');
    expect(dietaryLabel('vegan', 'nb')).toBe('Vegansk');
    expect(dietaryLabel('lactose_free', 'de')).toBe('Lactose-free');
  });
});

describe('deliveryWindowLabel', () => {
  const eta = { min: '2026-10-22T17:05:00.000Z', max: '2026-10-22T17:15:00.000Z' };
  it('shows the window in the restaurant time zone', () => {
    expect(deliveryWindowLabel(eta, 'nb-NO', 'Europe/Oslo')).toBe('Levert ca. 19:05–19:15');
    expect(deliveryWindowLabel(eta, 'en', 'Europe/Oslo')).toBe('Delivered around 19:05–19:15');
  });
  it('keeps an Arabic window left-to-right, and a window across midnight in order', () => {
    expect(deliveryWindowLabel(eta, 'ar', 'Europe/Oslo')).toBe('يصل حوالي \u206619:05–19:15\u2069');
    expect(
      deliveryWindowLabel(
        { min: '2026-10-22T21:55:00.000Z', max: '2026-10-22T22:05:00.000Z' },
        'nb',
        'Europe/Oslo'
      )
    ).toBe('Levert ca. 23:55–00:05');
  });
  it('one time when Wolt gives a single instant', () => {
    expect(deliveryWindowLabel({ min: eta.min, max: eta.min }, 'no', 'Europe/Oslo')).toBe(
      'Levert ca. 19:05'
    );
  });
});

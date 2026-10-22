/**
 * What a menu calls each allergen and dietary mark, in Norwegian, English and
 * Arabic — the same words Medal's own screens use. Keyed by the SDK's wire
 * values, so a value the API adds fails the typecheck here until it has a
 * label in every language.
 */
import type { OrderingAllergen, OrderingDietary } from '@medalsocial/sdk';

export type LabelLocale = 'nb' | 'en' | 'ar';

export type LabelSet = Readonly<Record<LabelLocale, string>>;

/** The 14 allergens EU Regulation 1169/2011 (Annex II) requires a menu to declare. */
export const ALLERGEN_LABELS: Readonly<Record<OrderingAllergen, LabelSet>> = {
  gluten: { nb: 'Gluten', en: 'Gluten', ar: 'الغلوتين' },
  crustaceans: { nb: 'Skalldyr', en: 'Crustaceans', ar: 'القشريات' },
  eggs: { nb: 'Egg', en: 'Eggs', ar: 'البيض' },
  fish: { nb: 'Fisk', en: 'Fish', ar: 'السمك' },
  peanuts: { nb: 'Peanøtter', en: 'Peanuts', ar: 'الفول السوداني' },
  soybeans: { nb: 'Soya', en: 'Soybeans', ar: 'الصويا' },
  milk: { nb: 'Melk', en: 'Milk', ar: 'الحليب' },
  nuts: { nb: 'Nøtter', en: 'Tree nuts', ar: 'المكسرات' },
  celery: { nb: 'Selleri', en: 'Celery', ar: 'الكرفس' },
  mustard: { nb: 'Sennep', en: 'Mustard', ar: 'الخردل' },
  sesame: { nb: 'Sesam', en: 'Sesame', ar: 'السمسم' },
  sulphites: { nb: 'Svoveldioksid og sulfitter', en: 'Sulphites', ar: 'الكبريتيت' },
  lupin: { nb: 'Lupin', en: 'Lupin', ar: 'الترمس' },
  molluscs: { nb: 'Bløtdyr', en: 'Molluscs', ar: 'الرخويات' },
};

export const DIETARY_LABELS: Readonly<Record<OrderingDietary, LabelSet>> = {
  vegan: { nb: 'Vegansk', en: 'Vegan', ar: 'نباتي صرف' },
  vegetarian: { nb: 'Vegetar', en: 'Vegetarian', ar: 'نباتي' },
  gluten_free: { nb: 'Glutenfri', en: 'Gluten-free', ar: 'خالٍ من الغلوتين' },
  lactose_free: { nb: 'Laktosefri', en: 'Lactose-free', ar: 'خالٍ من اللاكتوز' },
  halal: { nb: 'Halal', en: 'Halal', ar: 'حلال' },
  spicy: { nb: 'Sterk', en: 'Spicy', ar: 'حار' },
};

/** The label pack for a BCP 47 locale: Norwegian (nb/no/nn), Arabic, or English for the rest. */
export function labelLocale(locale: string): LabelLocale {
  const language = locale.toLowerCase().split('-')[0];
  if (language === 'nb' || language === 'no' || language === 'nn') return 'nb';
  return language === 'ar' ? 'ar' : 'en';
}

export function allergenLabel(allergen: OrderingAllergen, locale: string): string {
  return ALLERGEN_LABELS[allergen][labelLocale(locale)];
}

export function dietaryLabel(mark: OrderingDietary, locale: string): string {
  return DIETARY_LABELS[mark][labelLocale(locale)];
}

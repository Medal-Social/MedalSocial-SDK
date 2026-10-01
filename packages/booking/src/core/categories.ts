/**
 * Medal's service `category` is a free string, and a business can add one in
 * the dashboard at any time. The site groups by its own configured list
 * (`config.categories`), in display order, and anything unrecognised joins the
 * catch-all (`config.fallbackCategory`) rather than dropping off the page —
 * bookable, priced, and invisible.
 *
 * `audience: 'child'` is the kids' path: what the wizard used to spell as the
 * literal `'barn'` (a guest child's seat, the held link service, `?antall=`).
 */

import type { BookingCategory, BookingConfig } from './config';

type CategoryConfig = Pick<BookingConfig, 'categories' | 'fallbackCategory'>;

/** The configured keys, in display order. */
export function categoryOrder(config: CategoryConfig): string[] {
  return config.categories.map((category) => category.key);
}

/** A raw Medal category as one of the configured keys, or the fallback. */
export function normaliseCategory(config: CategoryConfig, raw: string | null | undefined): string {
  return config.categories.some((category) => category.key === raw)
    ? (raw as string)
    : config.fallbackCategory;
}

function categoryFor(config: CategoryConfig, raw: string | null | undefined): BookingCategory {
  const key = normaliseCategory(config, raw);
  return config.categories.find((category) => category.key === key) as BookingCategory;
}

/** Whether a (raw) category is a kids' group. */
export function isChildCategory(config: CategoryConfig, raw: string | null | undefined): boolean {
  return categoryFor(config, raw).audience === 'child';
}

/** The first kids' group, the one a link's «for a child» means. `null` when none is configured. */
export function childCategory(config: CategoryConfig): string | null {
  return config.categories.find((category) => category.audience === 'child')?.key ?? null;
}

/**
 * The adult group a service «grows up» into, by its group's `adultEquivalent`:
 * the group's own key, or the first `nameIncludes` rule the name matches.
 * `null` when the group names none.
 */
export function adultCategoryFor(
  config: CategoryConfig,
  service: { name: string; category: string }
): string | null {
  const rule = categoryFor(config, service.category).adultEquivalent;
  if (rule === undefined) return null;
  if (typeof rule === 'string') return rule;
  const name = service.name.toLocaleLowerCase();
  return (
    rule.find((entry) => name.includes(entry.nameIncludes.toLocaleLowerCase()))?.category ?? null
  );
}

/** The services in the adult group `service` grows up into — empty when it names none. */
export function adultEquivalent<S extends { name: string; category: string }>(
  config: CategoryConfig,
  service: S,
  services: readonly S[]
): S[] {
  const target = adultCategoryFor(config, service);
  return target === null ? [] : services.filter((candidate) => candidate.category === target);
}

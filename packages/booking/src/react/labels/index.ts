/**
 * `BookingLabels` — every word the booking UI shows, as one flat, typed,
 * serialisable record — and the built-in `nb` and `en` packs.
 *
 * Four parts, merged: the words the pure core assembles (`/core`'s
 * `LABEL_PACKS`: the clock, ages, the summary line), every meda screen's copy
 * (`screens.ts`), and what the React components draw or assemble themselves
 * (`wizard.ts`, `manage.ts`, `portal.ts`, `login.ts`). The packs name no
 * business; a site's own words go in through `labels` (or
 * `BookingConfig.labels`) and are merged over them key by key.
 */

import {
  type BookingLabels as CoreLabels,
  type KeyedLabels,
  LABEL_PACKS,
  labelPackFor,
} from '../../core/labels';
import { LOGIN_LABELS_EN, LOGIN_LABELS_NB, type LoginLabels } from './login';
import { MANAGE_LABELS_EN, MANAGE_LABELS_NB, type ManageLabels } from './manage';
import { PORTAL_LABELS_EN, PORTAL_LABELS_NB, type PortalLabels } from './portal';
import { SCREEN_LABELS_EN, SCREEN_LABELS_NB, type ScreenLabels } from './screens';
import { WIZARD_LABELS_EN, WIZARD_LABELS_NB, type WizardLabels } from './wizard';

export type { LoginLabels, ManageLabels, PortalLabels, ScreenLabels, WizardLabels };

/** One complete pack. `daypart.<key>` and `category.<key>` are per configured group. */
export type BookingLabels = CoreLabels &
  ScreenLabels &
  WizardLabels &
  ManageLabels &
  PortalLabels &
  LoginLabels &
  KeyedLabels;

/** What a site passes: any subset, by key. */
export type BookingLabelsInput = Partial<BookingLabels>;

const NB: BookingLabels = {
  ...LABEL_PACKS.nb,
  ...SCREEN_LABELS_NB,
  ...WIZARD_LABELS_NB,
  ...MANAGE_LABELS_NB,
  ...PORTAL_LABELS_NB,
  ...LOGIN_LABELS_NB,
  'category.barn': 'Barn',
  'category.annet': 'Annet',
};

const EN: BookingLabels = {
  ...LABEL_PACKS.en,
  ...SCREEN_LABELS_EN,
  ...WIZARD_LABELS_EN,
  ...MANAGE_LABELS_EN,
  ...PORTAL_LABELS_EN,
  ...LOGIN_LABELS_EN,
  // The default groups keep their Norwegian keys in any locale.
  'category.barn': 'Children',
  'category.annet': 'Other',
};

/** The built-in packs, by language subtag. */
export const BOOKING_LABELS: Readonly<Record<'nb' | 'en', Readonly<BookingLabels>>> = {
  nb: NB,
  en: EN,
};

/**
 * The built-in pack for `locale` (`nb` for Norwegian in any spelling, `en`
 * otherwise) with each of `overrides`' strings over it, later arguments
 * winning. A key whose value is not a string is ignored.
 */
export function mergeLabels(
  locale: string,
  ...overrides: ReadonlyArray<BookingLabelsInput | null | undefined>
): Readonly<BookingLabels> {
  const merged: Record<string, string> = { ...BOOKING_LABELS[labelPackFor(locale)] };
  for (const layer of overrides) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (typeof value === 'string') merged[key] = value;
    }
  }
  return merged as unknown as BookingLabels;
}

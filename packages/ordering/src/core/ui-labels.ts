/**
 * Every word the ordering components show a guest, in Norwegian and English.
 * Plain words for someone ordering food, not for staff. `{name}` marks a
 * value filled in at render time. Arabic and any other language fall back to
 * English here; a site passes its own words through `labels`, merged over the
 * pack key by key. Allergen and dietary names are in `./labels`, in nb, en and ar.
 *
 * In `/core`, not `/react`, so a server component can read and merge the
 * words (for its own markup, or to pass `labels` down) without importing a
 * `'use client'` module. No React here.
 */
import { labelLocale } from './labels';

export interface OrderingLabels {
  /** The closed notice. */
  closed: string;
  /** `{time}` today, e.g. «Åpner kl. 11:00». */
  opensToday: string;
  opensTomorrow: string;
  /** `{day}`: a weekday name from `weekdays`. */
  opensOn: string;
  /** `{date}`: a day and month, for an opening a week or more away. */
  opensOnDate: string;
  /** Sunday first, as `Date#getDay()` counts. */
  weekdays: readonly [string, string, string, string, string, string, string];
  /** The menu list. */
  categories: string;
  menuEmpty: string;
  allergens: string;
  dietary: string;
  soldOut: string;
  /** The dish sheet. */
  close: string;
  itemSoldOut: string;
  chooseExactly: string;
  chooseUpTo: string;
  chooseBetween: string;
  optional: string;
  none: string;
  mustChoose: string;
  mustChooseAtLeast: string;
  notPossible: string;
  quantity: string;
  fewer: string;
  more: string;
  note: string;
  noteHint: string;
  /** `{price}`: the unit price with the choices, times the quantity. */
  add: string;
  /** The same, when the sheet edits a line already in the cart. */
  update: string;
}

const NB: OrderingLabels = {
  closed: 'Restauranten tar ikke imot bestillinger nå.',
  opensToday: 'Åpner kl. {time}',
  opensTomorrow: 'Åpner i morgen kl. {time}',
  opensOn: 'Åpner {day} kl. {time}',
  opensOnDate: 'Åpner {date} kl. {time}',
  weekdays: ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'],
  categories: 'Kategorier',
  menuEmpty: 'Det er ingenting på menyen akkurat nå.',
  allergens: 'Allergener',
  dietary: 'Om retten',
  soldOut: 'Utsolgt',
  close: 'Lukk',
  itemSoldOut: 'Denne retten er utsolgt.',
  chooseExactly: 'Velg {n}',
  chooseUpTo: 'Velg opptil {n}',
  chooseBetween: 'Velg {min} til {max}',
  optional: 'Valgfritt',
  none: 'Ingen',
  mustChoose: 'Du må velge {n}.',
  mustChooseAtLeast: 'Du må velge minst {n}.',
  notPossible: 'Ett av valgene her er ikke mulig lenger.',
  quantity: 'Antall',
  fewer: 'Én færre',
  more: 'Én til',
  note: 'Beskjed til kjøkkenet',
  noteHint: 'Valgfritt, opptil {n} tegn.',
  add: 'Legg til · {price}',
  update: 'Oppdater · {price}',
};

const EN: OrderingLabels = {
  closed: 'The restaurant is not taking orders right now.',
  opensToday: 'Opens at {time}',
  opensTomorrow: 'Opens tomorrow at {time}',
  opensOn: 'Opens {day} at {time}',
  opensOnDate: 'Opens {date} at {time}',
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  categories: 'Categories',
  menuEmpty: 'There is nothing on the menu right now.',
  allergens: 'Allergens',
  dietary: 'About this dish',
  soldOut: 'Sold out',
  close: 'Close',
  itemSoldOut: 'This dish is sold out.',
  chooseExactly: 'Choose {n}',
  chooseUpTo: 'Choose up to {n}',
  chooseBetween: 'Choose {min} to {max}',
  optional: 'Optional',
  none: 'None',
  mustChoose: 'Please choose {n}.',
  mustChooseAtLeast: 'Please choose at least {n}.',
  notPossible: 'One of these choices is no longer possible.',
  quantity: 'Quantity',
  fewer: 'One fewer',
  more: 'One more',
  note: 'Note for the kitchen',
  noteHint: 'Optional, up to {n} characters.',
  add: 'Add · {price}',
  update: 'Update · {price}',
};

export const ORDERING_LABELS: Readonly<Record<'nb' | 'en', OrderingLabels>> = { nb: NB, en: EN };

/**
 * The pack for a BCP 47 locale (Norwegian for nb/no/nn, else English), with a
 * site's words over it. A key the site leaves `undefined` keeps the pack's word.
 */
export function mergeLabels(locale: string, labels?: Partial<OrderingLabels>): OrderingLabels {
  const pack = ORDERING_LABELS[labelLocale(locale) === 'nb' ? 'nb' : 'en'];
  const merged: Record<string, unknown> = { ...pack };
  // The pack's own keys only, so a stray key (`__proto__` included) changes nothing.
  for (const key of Object.keys(pack) as (keyof OrderingLabels)[]) {
    const value = labels?.[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as OrderingLabels;
}

/** `{key}` → the value; an unknown placeholder stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

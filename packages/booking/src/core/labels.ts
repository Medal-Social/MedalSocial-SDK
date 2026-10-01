/**
 * The words the pure core puts into strings it builds itself — the sticky
 * summary line, a day said relative to today, an age.
 *
 * Everything else a booking screen says belongs to the screen (the meda
 * `/booking` screens take their copy through a `labels` prop). These are the
 * few sentences that are assembled out of state, so the rule that assembles
 * them and the words it uses have to travel together.
 *
 * A template is a plain string with `{name}` holes, so a label pack stays
 * serialisable: it rides in `BookingConfig.labels`, which is a page prop.
 */

/** The labels the core reads. `/react` (P3) adds the screen copy on top. */
export interface CoreLabels {
  /** `i dag` — mid-sentence, for «Neste ledige i dag 14:15». */
  'clock.today': string;
  'clock.tomorrow': string;
  /** `I dag` — the same day, sized for a chip in the date strip. */
  'clock.todayChip': string;
  'clock.tomorrowChip': string;
  /** `{day} {time}` — «i dag 14:15». */
  'clock.when': string;
  /** `{date} kl. {time}` — the manage page's whole appointment in one line. */
  'clock.dateTime': string;
  /** `{min} år`. */
  'age.exact': string;
  /** `{min}–{max} år`, when only the birth year is known. */
  'age.range': string;
  /** The summary bar's stylist part for a null preference. */
  'summary.firstAvailable': string;
  /** The summary bar's time part before an hour is picked. */
  'summary.pickTime': string;
  /** `{count} tjenester` — a family's summary. */
  'summary.services': string;
  /** `{minutes} min totalt`. */
  'summary.totalMinutes': string;
  /** `{count} barn` — guest children on step 1. */
  'people.children': string;
  /** The logged-in parent's own seat. */
  'people.self': string;
  /** A guest grown-up's seat. */
  'people.adult': string;
}

/** Per-key copy for config-defined groups: `daypart.<key>`, `category.<key>`. */
export type KeyedLabels = {
  [key: `daypart.${string}`]: string;
  [key: `category.${string}`]: string;
};

export type BookingLabels = CoreLabels & KeyedLabels;

const NB: BookingLabels = {
  'clock.today': 'i dag',
  'clock.tomorrow': 'i morgen',
  'clock.todayChip': 'I dag',
  'clock.tomorrowChip': 'I morgen',
  'clock.when': '{day} {time}',
  'clock.dateTime': '{date} kl. {time}',
  'age.exact': '{min} år',
  'age.range': '{min}–{max} år',
  'summary.firstAvailable': 'Første ledige',
  'summary.pickTime': 'Velg tid',
  'summary.services': '{count} tjenester',
  'summary.totalMinutes': '{minutes} min totalt',
  'people.children': '{count} barn',
  'people.self': 'Meg selv',
  'people.adult': 'Voksen',
  'daypart.formiddag': 'Formiddag',
  'daypart.ettermiddag': 'Ettermiddag',
  'daypart.kveld': 'Kveld',
};

const EN: BookingLabels = {
  'clock.today': 'today',
  'clock.tomorrow': 'tomorrow',
  'clock.todayChip': 'Today',
  'clock.tomorrowChip': 'Tomorrow',
  'clock.when': '{day} {time}',
  'clock.dateTime': '{date} at {time}',
  'age.exact': '{min} yrs',
  'age.range': '{min}–{max} yrs',
  'summary.firstAvailable': 'First available',
  'summary.pickTime': 'Pick a time',
  'summary.services': '{count} services',
  'summary.totalMinutes': '{minutes} min in total',
  'people.children': '{count} children',
  'people.self': 'Me',
  'people.adult': 'Adult',
  'daypart.morning': 'Morning',
  'daypart.afternoon': 'Afternoon',
  'daypart.evening': 'Evening',
};

/** The built-in packs, by language subtag. */
export const LABEL_PACKS: Readonly<Record<'nb' | 'en', Readonly<BookingLabels>>> = {
  nb: NB,
  en: EN,
};

/** Norwegian in any of its three spellings reads the `nb` pack; anything else `en`. */
export function labelPackFor(locale: string): 'nb' | 'en' {
  const language = locale.toLowerCase().split('-')[0];
  return language === 'nb' || language === 'no' || language === 'nn' ? 'nb' : 'en';
}

/** The built-in pack for `locale`, with the site's own words over it. */
export function resolveLabels(
  locale: string,
  overrides?: Partial<BookingLabels> | null
): Readonly<BookingLabels> {
  const merged: BookingLabels = { ...LABEL_PACKS[labelPackFor(locale)] };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'string') (merged as unknown as Record<string, string>)[key] = value;
  }
  return merged;
}

/** `fill('{count} barn', { count: 2 })` → «2 barn». An unknown hole stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (hole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : hole
  );
}

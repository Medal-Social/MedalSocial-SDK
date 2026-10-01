/**
 * The words the pure core puts into strings it builds itself — the sticky
 * summary line, a day said relative to today, an age.
 *
 * Everything else a booking screen says belongs to the screen (the meda
 * `/booking` screens take their copy through a `labels` prop). These are the
 * few sentences that are assembled out of state, so the rule that assembles
 * them and the words it uses have to travel together.
 *
 * A template has `{name}` holes and is a `BookingLabel`: a string or an array
 * of strings, so a label pack stays serialisable (it rides in
 * `BookingConfig.labels`, which is a page prop). Rendered as element children
 * (`fillParts`), a string is ONE text node once filled and an array is one
 * text node per element; as text (`fill`), an array's elements are joined.
 */

/**
 * One label. A `string` renders as one text node once filled, like a template
 * literal; a `string[]` renders one text node per element, each filled with
 * the same values: `['Steg ', '{step}', ' av ', '{total}']` is four nodes.
 * Text-only targets (`aria-label`, ICS, a file name) read it joined.
 */
export type BookingLabel = string | readonly string[];

/** Whether `value` is a `BookingLabel`: a string, or an array of strings. */
export function isBookingLabel(value: unknown): value is BookingLabel {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((piece) => typeof piece === 'string'))
  );
}

/** The labels the core reads. `/react` (P3) adds the screen copy on top. */
export interface CoreLabels {
  /** `i dag` — mid-sentence, for «Neste ledige i dag 14:15». */
  'clock.today': BookingLabel;
  'clock.tomorrow': BookingLabel;
  /** `I dag` — the same day, sized for a chip in the date strip. */
  'clock.todayChip': BookingLabel;
  'clock.tomorrowChip': BookingLabel;
  /** `{day} {time}` — «i dag 14:15». */
  'clock.when': BookingLabel;
  /** `{date} kl. {time}` — the manage page's whole appointment in one line. */
  'clock.dateTime': BookingLabel;
  /** `{min} år`. */
  'age.exact': BookingLabel;
  /** `{min}–{max} år`, when only the birth year is known. */
  'age.range': BookingLabel;
  /** The summary bar's stylist part for a null preference. */
  'summary.firstAvailable': BookingLabel;
  /** The summary bar's time part before an hour is picked. */
  'summary.pickTime': BookingLabel;
  /** `{count} tjenester` — a family's summary. */
  'summary.services': BookingLabel;
  /** `{minutes} min totalt`. */
  'summary.totalMinutes': BookingLabel;
  /** `{count} barn` — guest children on step 1. */
  'people.children': BookingLabel;
  /** The logged-in parent's own seat. */
  'people.self': BookingLabel;
  /** A guest grown-up's seat. */
  'people.adult': BookingLabel;
}

/** Per-key copy for config-defined groups: `daypart.<key>`, `category.<key>`. */
export type KeyedLabels = {
  [key: `daypart.${string}`]: BookingLabel;
  [key: `category.${string}`]: BookingLabel;
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
  // The default day parts keep their Norwegian keys in any locale.
  'daypart.formiddag': 'Morning',
  'daypart.ettermiddag': 'Afternoon',
  'daypart.kveld': 'Evening',
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
    if (isBookingLabel(value)) (merged as unknown as Record<string, BookingLabel>)[key] = value;
  }
  return merged;
}

function fillOne(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (hole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : hole
  );
}

/** A label as plain text: an array's elements joined, a string as it is. */
export function labelText(label: BookingLabel): string {
  return typeof label === 'string' ? label : label.join('');
}

/**
 * `fill('{count} barn', { count: 2 })` → «2 barn», as plain text: an array is
 * filled element by element and joined. An unknown hole stays as written.
 */
export function fill(
  template: BookingLabel,
  values: Readonly<Record<string, string | number>>
): string {
  return typeof template === 'string'
    ? fillOne(template, values)
    : template.map((piece) => fillOne(piece, values)).join('');
}

/**
 * A filled label as the text nodes it renders as: one for a string (like a
 * template literal), one per element for an array, each element filled with
 * the same values — `fillParts(['Steg ', '{step}', ' av {total}'], { step: 3,
 * total: 4 })` → `['Steg ', '3', ' av 4']`. Rendered as element children,
 * each entry becomes its own text node, so a pack decides where a sentence
 * breaks (a browser lays text out per text node, and the same sentence split
 * differently can land a sub-pixel apart). Use `fill` where the target takes
 * text only (`aria-label`, `title`, ICS). Empty pieces are dropped.
 */
export function fillParts(
  template: BookingLabel,
  values: Readonly<Record<string, string | number>>
): string[] {
  const pieces = typeof template === 'string' ? [template] : template;
  return pieces.map((piece) => fillOne(piece, values)).filter((piece) => piece !== '');
}

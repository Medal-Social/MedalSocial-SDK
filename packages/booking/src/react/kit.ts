/**
 * Everything a booking screen needs that depends on the site, built once per
 * config and label pack: the core factories (machine, clock, money, phone, …)
 * and the `format` object every meda screen takes.
 *
 * One kit per `(config, labels)` pair, memoised, so the components that share
 * a `BookingProvider` share one clock (whose formatters are the expensive
 * part) and one wizard.
 */

import type { BookingClock, BookingDaypart, BookingFormat } from '@medalsocial/meda/booking';
import { type Age, createAge } from '../core/age';
import { type AttemptStore, createAttemptStore } from '../core/attempt-store';
import { childCategory } from '../core/categories';
import { type Clock, createClock } from '../core/clock';
import type { BookingConfig } from '../core/config';
import { createDeepLinks, type DeepLinks } from '../core/deep-link';
import { initialsOf, stylistDisplayName } from '../core/display-name';
import { createDraftStore, type DraftStore } from '../core/draft-store';
import { createIcs, type Ics } from '../core/ics';
import { labelText } from '../core/labels';
import { createWizard, type Wizard } from '../core/machine';
import { createMoney, type Money } from '../core/money';
import { createPartySlots, type PartySlots } from '../core/party-slots';
import { createPaths, type Paths } from '../core/paths';
import { createPhone, type Phone } from '../core/phone';
import { createRebookStore, type RebookStore } from '../core/rebook-store';
import { createRestoreGate, type RestoreGate } from '../core/restore-gate';
import type { BookingLabels } from './labels';

export interface BookingKit {
  /** The config with the merged label pack folded in, so the core reads the same words. */
  readonly config: Readonly<BookingConfig>;
  readonly labels: Readonly<BookingLabels>;
  readonly format: BookingFormat;
  readonly clock: Clock & BookingClock;
  readonly wizard: Wizard;
  readonly money: Money;
  readonly phone: Phone;
  readonly age: Age;
  readonly deepLinks: DeepLinks;
  readonly drafts: DraftStore;
  readonly attempts: AttemptStore;
  readonly rebook: RebookStore;
  readonly restoreGate: RestoreGate;
  readonly partySlots: PartySlots;
  readonly ics: Ics;
  readonly paths: Paths;
  /** The day parts in order, as the time step takes them. */
  readonly dayparts: readonly BookingDaypart[];
  /**
   * The service groups in order, as the service step takes them — with each
   * group's audience, so a child in a family is offered the groups meant for
   * anyone (meda 3.6 `ServiceScreenCategory.audience`).
   */
  readonly categories: ReadonlyArray<{
    key: string;
    label: string;
    audience: 'child' | 'adult' | 'any';
  }>;
  /** The kids' group, or `null` when the site has none. */
  readonly childCategory: string | null;
  /** «Theos» / «Jonas'» — the language's possessive of a name. */
  possessive(name: string): string;
}

/** «barn» → «Barn», for a group the label pack has no word for. */
function capitalised(key: string, locale: string): string {
  return `${key.charAt(0).toLocaleUpperCase(locale)}${key.slice(1)}`;
}

function isNorwegian(locale: string): boolean {
  const language = locale.toLowerCase().split('-')[0];
  return language === 'nb' || language === 'no' || language === 'nn';
}

/**
 * The possessive the age divider puts a child's name in. Norwegian adds `s`,
 * or an apostrophe after a name that already ends in s, x or z («Theos»,
 * «Jonas'»); English adds `'s`, or the apostrophe alone after an s.
 */
function possessiveFor(locale: string): (name: string) => string {
  if (isNorwegian(locale)) return (name) => (/[sxz]$/i.test(name) ? `${name}'` : `${name}s`);
  return (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
}

/** The two things meda's clock asks for that the core clock does not draw. */
function calendarWords(config: Pick<BookingConfig, 'locale' | 'timeZone'>) {
  const month = new Intl.DateTimeFormat(config.locale, { month: 'long', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(config.locale, { weekday: 'short', timeZone: 'UTC' });
  const months = Array.from({ length: 12 }, (_, index) => month.format(Date.UTC(2026, index, 15)));
  // 5 January 2026 is a Monday: seven days from it are the heads, Monday first.
  const heads = Array.from({ length: 7 }, (_, index) => {
    const short = weekday.format(Date.UTC(2026, 0, 5 + index)).replace(/\.$/, '');
    return capitalised(short.slice(0, 2), config.locale);
  });
  return {
    monthName: (value: number) => months[(value - 1 + 12) % 12],
    weekdayHeads: () => heads,
  };
}

const KITS = new WeakMap<object, WeakMap<object, BookingKit>>();

/**
 * The kit for one config and one merged label pack. Pass the SAME objects to
 * get the same kit back; `BookingProvider` and the components memoise them.
 */
export function createBookingKit(
  config: Readonly<BookingConfig>,
  labels: Readonly<BookingLabels>
): BookingKit {
  let byLabels = KITS.get(config);
  if (byLabels === undefined) {
    byLabels = new WeakMap();
    KITS.set(config, byLabels);
  }
  const known = byLabels.get(labels);
  if (known !== undefined) return known;
  const kit = buildKit(config, labels);
  byLabels.set(labels, kit);
  return kit;
}

function buildKit(base: Readonly<BookingConfig>, labels: Readonly<BookingLabels>): BookingKit {
  const config: Readonly<BookingConfig> = Object.freeze({ ...base, labels });
  const core = createClock(config);
  const clock: Clock & BookingClock = { ...core, ...calendarWords(config) };
  const money = createMoney(config);
  const phone = createPhone(config);
  const age = createAge(config);
  const format: BookingFormat = {
    clock,
    price: (minor) => money.formatMinor(minor),
    telHref: (value) => phone.telHref(value),
    stylistName: stylistDisplayName,
    initials: initialsOf,
    ageLabel: (range) => age.ageLabel(range),
  };
  return {
    config,
    labels,
    format,
    clock,
    wizard: createWizard(config),
    money,
    phone,
    age,
    deepLinks: createDeepLinks(config),
    drafts: createDraftStore(config.storageNamespace),
    attempts: createAttemptStore(config.storageNamespace),
    rebook: createRebookStore(config.storageNamespace),
    restoreGate: createRestoreGate(config.storageNamespace),
    partySlots: createPartySlots(config),
    ics: createIcs(config),
    paths: createPaths(config),
    dayparts: config.dayparts.map((part) => ({
      key: part.key,
      label: core.daypartLabel(part.key),
    })),
    categories: config.categories.map(({ key, audience }) => {
      const label = labels[`category.${key}`];
      return {
        key,
        label: label === undefined ? capitalised(key, config.locale) : labelText(label),
        audience,
      };
    }),
    childCategory: childCategory(config),
    possessive: possessiveFor(config.locale),
  };
}

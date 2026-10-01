/**
 * How old a child is ON THE APPOINTMENT DAY — the one age that decides which
 * haircut and which price they get.
 *
 * The profile keeps a birth YEAR and, since SP10, optionally a birth MONTH —
 * never a full date (data minimisation for children). So the answer is a
 * RANGE: with the month it is exact (Medal's own `ageOnDay` counts the
 * birthday as the first of the month, and this agrees with it), without it
 * the child is one of two ages depending on whether the birthday has been yet
 * this year, which the card says honestly as «7–8 år».
 *
 * `dayKey` is `clock.dayKey`'s `2026-08-29` — the SALON's calendar date, not the
 * viewer's, for the reason every date on this site is.
 *
 * Pure and dependency-free, so the wizard (a browser bundle) and the portal (a
 * server render) read the same number.
 *
 * `ageOnDay` and `fitsAge` are config-free; `createAge(config)` adds the two
 * that are not — the label's words, and which adult group a kids' service
 * grows up into (`categories[].adultEquivalent`, which replaced a hard-coded
 * table of Norwegian service names).
 */

import { adultEquivalent } from './categories';
import type { BookingConfig } from './config';
import { type BookingLabels, fill, resolveLabels } from './labels';

type AgeConfig = Pick<BookingConfig, 'categories' | 'fallbackCategory' | 'locale' | 'labels'>;

export interface AgeRange {
  /** Inclusive; equal to `max` when the age is exact. */
  min: number;
  max: number;
}

export function ageOnDay(
  birthYear: number,
  birthMonth: number | null | undefined,
  dayKey: string
): AgeRange | null {
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(birthYear)) {
    return null;
  }
  const yearDiff = year - birthYear;
  if (yearDiff < 0) return null;
  const hasMonth =
    typeof birthMonth === 'number' &&
    Number.isInteger(birthMonth) &&
    birthMonth >= 1 &&
    birthMonth <= 12;
  if (hasMonth) {
    const exact = month < birthMonth ? yearDiff - 1 : yearDiff;
    return exact < 0 ? null : { min: exact, max: exact };
  }
  return { min: Math.max(0, yearDiff - 1), max: yearDiff };
}

/** «7 år», or «7–8 år» when only the year is known — in the words of `labels`. */
function ageLabel(labels: Readonly<BookingLabels>, range: AgeRange): string {
  return range.min === range.max
    ? fill(labels['age.exact'], { min: range.min })
    : fill(labels['age.range'], { min: range.min, max: range.max });
}

/** A service's age range, as the wizard carries it (`WizardService`). */
export interface AgeBounds {
  ageMinYears?: number;
  ageMaxYears?: number;
}

/**
 * Whether a service can be suggested for a child of this age. Only a CERTAIN
 * miss rules it out: a child who is «6–7 år» is not too old for a service up
 * to 6, because they may still be six on the day. `null` — nobody's age is
 * known (a guest, a grown-up) — fits everything.
 */
export function fitsAge(service: AgeBounds, age: AgeRange | null): boolean {
  if (age === null) return true;
  if (service.ageMaxYears !== undefined && age.min > service.ageMaxYears) return false;
  if (service.ageMinYears !== undefined && age.max < service.ageMinYears) return false;
  return true;
}

/**
 * What «Samme som sist» becomes for a child who has outgrown their last cut:
 * the one service in the same category that fits their age now — an
 * age-banded one first (a «Barnehageklipp» child is a «Barneklipp» child at
 * seven) — or — where the
 * category holds none — the grown-up cut its group's `adultEquivalent` points at (by
 * name: «gutt» → the men's group, «jente» → the women's), again only when
 * exactly one fits. Anything less
 * certain is `null`: the parent picks from the menu, which is better than a
 * guess that books the wrong cut at the wrong price.
 */
function grownUpEquivalent<S extends AgeBounds & { id: string; name: string; category: string }>(
  config: AgeConfig,
  last: S,
  candidates: readonly S[],
  age: AgeRange | null
): S | null {
  const fitting = candidates.filter((service) => service.id !== last.id && fitsAge(service, age));
  const sameCategory = fitting.filter((service) => service.category === last.category);
  // A service the salon banded by age is the likelier «next size up» than one
  // it did not — «Barneklipp 7–12» over «Hull i ørene» — so those are asked first.
  const banded = sameCategory.filter(
    (service) => service.ageMinYears !== undefined || service.ageMaxYears !== undefined
  );
  if (banded.length === 1) return banded[0];
  if (sameCategory.length === 1) return sameCategory[0];
  const grownUp = adultEquivalent(config, last, fitting);
  return grownUp.length === 1 ? grownUp[0] : null;
}

export interface Age {
  ageOnDay: typeof ageOnDay;
  fitsAge: typeof fitsAge;
  ageLabel(range: AgeRange): string;
  grownUpEquivalent<S extends AgeBounds & { id: string; name: string; category: string }>(
    last: S,
    candidates: readonly S[],
    age: AgeRange | null
  ): S | null;
}

export function createAge(config: AgeConfig): Age {
  const labels = resolveLabels(config.locale, config.labels);
  return {
    ageOnDay,
    fitsAge,
    ageLabel: (range) => ageLabel(labels, range),
    grownUpEquivalent: (last, candidates, age) => grownUpEquivalent(config, last, candidates, age),
  };
}

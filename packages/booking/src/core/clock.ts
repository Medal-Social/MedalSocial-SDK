/**
 * Every clock face the booking flow shows belongs to the business, never to
 * the viewer.
 *
 * A family booking from a holiday abroad has to read 15:00 on the chip they
 * will actually turn up for, and a slot at 00:30 on Saturday has to carry
 * Saturday's surcharge even though UTC still calls it Friday. `Date`'s
 * local-time getters answer for whoever is looking, so nothing in the wizard
 * uses them: hours, days and weekday names all come from here.
 *
 * Pure, and free of React and fetch for the same reason the wizard machine is
 * — the business's clock is a rule, and a rule that needs a DOM to test is a
 * rule nobody tests.
 *
 * `createClock(config)` returns the function set for one zone, one locale and
 * one set of day parts. The `Intl` formatters behind it are built once per
 * zone and locale and shared by every clock that asks for the same pair.
 */

import type { BookingConfig, BookingDaypart } from './config';
import { type BookingLabels, fill, resolveLabels } from './labels';

interface Formatters {
  /** `h23` rather than `hour12: false`, which renders midnight as `24:00` on some ICU builds. */
  time: Intl.DateTimeFormat;
  /**
   * `en-US` for the parts nobody reads: `weekday: 'short'` has to be matched
   * against a literal below, and `Sat`/`Sun` are stable where a localised
   * `lør.`/`søn.` would drift with the ICU data the runtime happens to ship.
   */
  parts: Intl.DateTimeFormat;
  weekdayLong: Intl.DateTimeFormat;
  weekdayShort: Intl.DateTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  /**
   * `tor. 8. okt.` — a date that does not need to know what today is.
   *
   * The wizard can say «i morgen» because the visitor is standing in it. The
   * manage page cannot: it is opened out of an e-mail, possibly weeks later and
   * possibly by the other parent, and a relative day would be a claim about the
   * moment the page happened to render.
   */
  fullDate: Intl.DateTimeFormat;
  /** The wall clock down to the second — the one thing `parts` cannot give, and only `offsetMs` needs. */
  wallClock: Intl.DateTimeFormat;
}

/**
 * Built once each: constructing a formatter is the expensive half of `Intl`,
 * and the time step formats every slot in a week on each re-render.
 */
const FORMATTERS = new Map<string, Formatters>();

function formattersFor(timeZone: string, locale: string): Formatters {
  const cacheKey = `${timeZone}\u0000${locale}`;
  const cached = FORMATTERS.get(cacheKey);
  if (cached !== undefined) return cached;
  const built: Formatters = {
    time: new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }),
    parts: new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }),
    weekdayLong: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }),
    weekdayShort: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: 'numeric' }),
    dayMonth: new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short' }),
    fullDate: new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    wallClock: new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
  };
  FORMATTERS.set(cacheKey, built);
  return built;
}

export interface Clock {
  readonly timeZone: string;
  /** The day part keys, in order. */
  readonly dayparts: readonly string[];
  dayStart(ts: number, offsetDays?: number): number;
  window(fromTs: number, rangeDays: number): { fromTs: number; toTs: number; days: number[] };
  formatTime(ts: number): string;
  hour(ts: number): number;
  dayKey(ts: number): string;
  isWeekend(ts: number): boolean;
  daysBetween(from: number, to: number): number;
  daypartOf(ts: number): string;
  daypartLabel(key: string): string;
  dayLabel(ts: number, now?: number): string;
  dayChip(ts: number, now?: number): string;
  when(ts: number, now?: number): string;
  date(ts: number): string;
  dateTime(ts: number): string;
  weekday(ts: number): string;
}

export type ClockConfig = Pick<BookingConfig, 'timeZone' | 'locale' | 'dayparts'> & {
  labels?: Partial<BookingLabels>;
};

/** One clock per config object: every factory that needs the clock asks for it. */
const CLOCKS = new WeakMap<ClockConfig, Clock>();

export function createClock(config: ClockConfig): Clock {
  const known = CLOCKS.get(config);
  if (known !== undefined) return known;
  const clock = buildClock(config);
  CLOCKS.set(config, clock);
  return clock;
}

function buildClock(config: ClockConfig): Clock {
  const { timeZone } = config;
  const f = formattersFor(timeZone, config.locale);
  const labels = resolveLabels(config.locale, config.labels);
  const dayparts: readonly BookingDaypart[] = config.dayparts;

  function partsOf(ts: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of f.parts.formatToParts(ts)) out[part.type] = part.value;
    return out;
  }

  /**
   * How far ahead of UTC the business is at a given instant — `+1 h` in winter,
   * `+2 h` in summer for Oslo.
   *
   * Read from the zone database rather than assumed, because the whole point of
   * the two functions below is the two days a year when it changes.
   */
  function offsetMs(ts: number): number {
    const out: Record<string, string> = {};
    for (const part of f.wallClock.formatToParts(ts)) out[part.type] = part.value;
    const asIfUtc = Date.UTC(
      Number(out.year),
      Number(out.month) - 1,
      Number(out.day),
      Number(out.hour),
      Number(out.minute),
      Number(out.second)
    );
    // The formatter has no milliseconds, so neither does the comparison.
    return asIfUtc - (ts - (((ts % 1000) + 1000) % 1000));
  }

  /**
   * Midnight on the business's clock, `offsetDays` calendar days after the day
   * `ts` falls in.
   *
   * The reason this is not `ts + n * 86_400_000`: adding a fixed 24 hours assumes
   * every day is 24 hours long, and two of them a year are not. Late on the
   * Saturday before the clocks go forward, +24 h lands on the Monday and Sunday
   * disappears; early on the Sunday they go back, +24 h lands on the same Sunday
   * again and the far end of the week is lost. Either way a day strip built that
   * way stops describing the week the availability query asked about.
   *
   * Two passes, because the offset has to be read at the answer rather than at the
   * guess: `wall` is midnight on the target date treated as if the zone were UTC,
   * and the offset in force at the true instant is the one that turns it back into
   * one. The second read settles the case where the guess falls on the other side
   * of a transition from the day it belongs to.
   */
  function dayStart(ts: number, offsetDays = 0): number {
    const parts = partsOf(ts);
    const wall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) + offsetDays
    );
    const guess = wall - offsetMs(wall);
    return wall - offsetMs(guess);
  }

  /**
   * The days the time step may offer and the instant the availability query
   * stops at — derived together, so they cannot disagree.
   *
   * `days` is one instant inside each business day, starting with the day
   * `fromTs` falls in; `toTs` is the midnight that ends the last of them. That is
   * the whole contract: every opening the engine can return has a chip to sit
   * on, and every chip covers a stretch the engine was actually asked about.
   *
   * `fromTs` is returned untouched and is NOT snapped to midnight: it is the
   * moment the visitor is standing in, and a query that started at this morning's
   * midnight would ask the engine about hours that are already gone.
   */
  function window(
    fromTs: number,
    rangeDays: number
  ): { fromTs: number; toTs: number; days: number[] } {
    return {
      fromTs,
      toTs: dayStart(fromTs, rangeDays),
      days: Array.from({ length: rangeDays }, (_, index) => dayStart(fromTs, index)),
    };
  }

  /** `15:00` — the string on the chip, the summary bar and the confirmation. */
  function formatTime(ts: number): string {
    return f.time.format(ts);
  }

  /** The hour 0–23 as the business reads it. */
  function hour(ts: number): number {
    return Number(partsOf(ts).hour);
  }

  /**
   * `2026-09-03` — the identity of a *business* day, which is what slots group
   * by. Slicing an ISO string instead would file 00:30 on Thursday under
   * Wednesday and split one opening day across two headings.
   */
  function dayKey(ts: number): string {
    const parts = partsOf(ts);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function isWeekend(ts: number): boolean {
    const weekday = partsOf(ts).weekday;
    return weekday === 'Sat' || weekday === 'Sun';
  }

  function utcMidnight(ts: number): number {
    const parts = partsOf(ts);
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  }

  /**
   * Whole days between two instants on the business calendar, so «tomorrow»
   * means the next opening day rather than "in 24 hours". Anchoring both to UTC
   * midnight after the parts have already been read in the zone keeps the
   * arithmetic clear of the hour the clocks change, where a naive subtraction
   * is off by one.
   */
  function daysBetween(from: number, to: number): number {
    return (utcMidnight(to) - utcMidnight(from)) / 86_400_000;
  }

  /** The configured part the hour falls in — on the business's clock. */
  function daypartOf(ts: number): string {
    const h = hour(ts);
    const part = dayparts.find((candidate) => h >= candidate.from && h < candidate.to);
    // A validated config covers 0–24, so this only answers for a hand-built one.
    return (part ?? dayparts[dayparts.length - 1]).key;
  }

  function daypartLabel(key: string): string {
    return labels[`daypart.${key}`] ?? key;
  }

  /**
   * `i dag` / `i morgen` / `lørdag` / `10. sep.`, mid-sentence.
   *
   * The weekday name stops being useful after six days — «torsdag» could then be
   * either of two Thursdays — so the date takes over rather than being ambiguous
   * about which week the business expects you.
   */
  function dayLabel(ts: number, now: number = Date.now()): string {
    const days = daysBetween(now, ts);
    if (days === 0) return labels['clock.today'];
    if (days === 1) return labels['clock.tomorrow'];
    if (days > 1 && days < 7) return f.weekdayLong.format(ts);
    return f.dayMonth.format(ts);
  }

  /** The same day, sized for a chip in the date strip: `I dag`, `lør. 5.`. */
  function dayChip(ts: number, now: number = Date.now()): string {
    const days = daysBetween(now, ts);
    if (days === 0) return labels['clock.todayChip'];
    if (days === 1) return labels['clock.tomorrowChip'];
    return f.weekdayShort.format(ts);
  }

  /** `i dag 14:15` — a day and a time in one breath, for «Neste ledige». */
  function when(ts: number, now: number = Date.now()): string {
    return fill(labels['clock.when'], { day: dayLabel(ts, now), time: formatTime(ts) });
  }

  /**
   * `tor. 8. okt.` — the calendar date, with no reference to now.
   *
   * The month keeps ICU's trailing full stop (`okt.`, not `okt`), because that is
   * how Norwegian abbreviates a month and this file does not second-guess the
   * locale data.
   */
  function date(ts: number): string {
    return f.fullDate.format(ts);
  }

  /** `tor. 8. okt. kl. 15:00` — the whole appointment in one line, absolute in both halves. */
  function dateTime(ts: number): string {
    return fill(labels['clock.dateTime'], { date: date(ts), time: formatTime(ts) });
  }

  /** `lørdag` — the weekday's own name, for «lørdagspris». */
  function weekday(ts: number): string {
    return f.weekdayLong.format(ts);
  }

  return {
    timeZone,
    dayparts: dayparts.map((part) => part.key),
    dayStart,
    window,
    formatTime,
    hour,
    dayKey,
    isWeekend,
    daysBetween,
    daypartOf,
    daypartLabel,
    dayLabel,
    dayChip,
    when,
    date,
    dateTime,
    weekday,
  };
}

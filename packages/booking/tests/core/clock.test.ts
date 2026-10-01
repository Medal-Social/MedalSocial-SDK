import { describe, expect, it } from 'vitest';
import { createClock } from '../../src/core/clock';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

const {
  daypartOf,
  formatTime: formatSalonTime,
  isWeekend: isSalonWeekend,
  dayChip: salonDayChip,
  dayKey: salonDayKey,
  dayLabel: salonDayLabel,
  when: salonWhen,
  window: salonWindow,
} = createClock(PARITY_CONFIG);

// Every assertion below fails if any of these helpers reaches for `Date`'s
// local-time getters instead of the zone it names.
pinAForeignViewerClock();

/**
 * An instant expressed as Oslo wall time, spelled with the offset rather than
 * computed: 2026-09-03 is inside CEST, so Oslo is UTC+02:00. `Date.parse` of an
 * offset-bearing ISO string is the one construction the runner's own zone
 * cannot move.
 */
function oslo(day: number, hour: number, minute = 0): number {
  const pad = (value: number) => String(value).padStart(2, '0');
  return Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
}

const THURSDAY = 3;
const SATURDAY = 5;
const SUNDAY = 6;

describe('salon clock', () => {
  it('is actually being asked from somewhere else', () => {
    // Guards the guard: if `process.env.TZ` stopped taking effect mid-process,
    // every other test here would keep passing while proving nothing.
    expect(new Date(oslo(THURSDAY, 15)).getHours()).not.toBe(15);
  });

  it('renders the salon time, 24-hour, whoever is looking', () => {
    expect(formatSalonTime(oslo(THURSDAY, 15))).toBe('15:00');
    expect(formatSalonTime(oslo(THURSDAY, 9, 5))).toBe('09:05');
  });

  it('cuts the dayparts at 12:00 and 17:00 on the salon clock', () => {
    expect(daypartOf(oslo(THURSDAY, 11, 59))).toBe('formiddag');
    expect(daypartOf(oslo(THURSDAY, 12))).toBe('ettermiddag');
    expect(daypartOf(oslo(THURSDAY, 16, 59))).toBe('ettermiddag');
    expect(daypartOf(oslo(THURSDAY, 17))).toBe('kveld');
  });

  it('groups a day by the salon calendar, not the UTC one', () => {
    // 00:30 in Oslo is still the previous day in UTC. A key taken off the ISO
    // string would file this slot under Wednesday and split Thursday in two.
    expect(salonDayKey(oslo(THURSDAY, 0, 30))).toBe('2026-09-03');
    expect(salonDayKey(oslo(THURSDAY, 23, 30))).toBe('2026-09-03');
  });

  it('knows the salon weekend, including across the UTC date line', () => {
    expect(isSalonWeekend(oslo(THURSDAY, 15))).toBe(false);
    expect(isSalonWeekend(oslo(SATURDAY, 15))).toBe(true);
    expect(isSalonWeekend(oslo(SUNDAY, 15))).toBe(true);
    // Saturday 00:30 in Oslo is Friday 22:30 in UTC — the surcharge applies to
    // the salon's Saturday, not the world's.
    expect(isSalonWeekend(oslo(SATURDAY, 0, 30))).toBe(true);
  });

  it('says i dag and i morgen before it says a weekday', () => {
    const now = oslo(THURSDAY, 15);
    expect(salonDayLabel(oslo(THURSDAY, 9), now)).toBe('i dag');
    expect(salonDayLabel(oslo(THURSDAY + 1, 9), now)).toBe('i morgen');
    expect(salonDayLabel(oslo(THURSDAY + 2, 9), now)).toBe('lørdag');
    // Past a week a weekday name is ambiguous — «torsdag» could be either one.
    expect(salonDayLabel(oslo(THURSDAY + 7, 9), now)).toBe('10. sep.');
  });

  it('labels a day the same way whichever side of midnight the viewer is on', () => {
    // 23:30 on the salon's Thursday is already Friday afternoon in Kiritimati,
    // so a label computed from the viewer's calendar would read «i morgen».
    expect(salonDayLabel(oslo(THURSDAY, 23, 30), oslo(THURSDAY, 15))).toBe('i dag');
  });

  it('capitalises the day strip and joins day to time for a stylist line', () => {
    const now = oslo(THURSDAY, 15);
    expect(salonDayChip(oslo(THURSDAY, 9), now)).toBe('I dag');
    expect(salonDayChip(oslo(THURSDAY + 1, 9), now)).toBe('I morgen');
    expect(salonDayChip(oslo(SATURDAY, 9), now)).toBe('lør. 5.');
    expect(salonWhen(oslo(THURSDAY, 14, 15), now)).toBe('i dag 14:15');
  });
});

/**
 * The window step 3 draws its day strip from, and the same window the
 * availability query asks about.
 *
 * They have to be the same one. A `to_ts` of «now plus seven times 86 400 000»
 * reaches into an eighth calendar day whenever the page is opened after
 * midnight — openings the strip has no chip for, so they can be quoted as a
 * stylist's «Neste ledige» and then not exist on any day the visitor can tap.
 */
describe('salon window', () => {
  /** The salon dates a window covers, which is what the day strip renders. */
  const keys = (fromTs: number, days: number) => salonWindow(fromTs, days).days.map(salonDayKey);

  it('gives one day per requested day, starting with the one being stood in', () => {
    expect(keys(oslo(THURSDAY, 15), 7)).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
  });

  it('ends the window where the last day it can draw ends', () => {
    const { toTs, days } = salonWindow(oslo(THURSDAY, 15), 7);
    // The last instant inside the window has to belong to the last chip. A
    // bound an hour further on is an opening nobody can reach.
    expect(salonDayKey(toTs - 1)).toBe(salonDayKey(days[days.length - 1]));
    // And the bound itself is the next day's midnight, not some hour inside it.
    expect(formatSalonTime(toTs)).toBe('00:00');
  });

  it('starts the window no later than the instant asked about', () => {
    // The strip's first entry is a marker for today, not a promise that the
    // salon is open at midnight — but it must not sit AFTER the moment the
    // query starts at, or today's chip would name a day the query skipped.
    const fromTs = oslo(THURSDAY, 15);
    expect(salonWindow(fromTs, 7).days[0]).toBeLessThanOrEqual(fromTs);
  });

  /**
   * The clocks going forward eat an hour out of Sunday 29 March 2026, so a
   * strip built by adding 86 400 000 seven times from late on the Saturday
   * jumps straight from Saturday to Monday — and the salon's Sunday is missing
   * from a week that is supposed to contain it.
   */
  it('does not skip a day when the clocks go forward', () => {
    const lateSaturday = Date.parse('2026-03-28T23:30:00+01:00');
    expect(keys(lateSaturday, 7)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
    ]);
  });

  /**
   * And back the other way: 25 October 2026 is twenty-five hours long, so two
   * of the seven +24 h steps land on the same Sunday and the strip loses a day
   * off the far end.
   */
  it('does not repeat a day when the clocks go back', () => {
    const earlySunday = Date.parse('2026-10-25T00:30:00+02:00');
    expect(keys(earlySunday, 7)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });
});

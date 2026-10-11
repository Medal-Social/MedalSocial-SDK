import { describe, expect, it } from 'vitest';
import { createClock } from '../../src/core/clock';
import { MAX_RANGE_DAYS, MAX_RANGE_MS } from '../../src/core/range';
import { parseRange } from '../../src/next/routes/shared';

/**
 * The window the wizard builds and the range the read routes admit are two
 * pieces of arithmetic in two layers. They disagreed once: `window()` ends at a
 * business midnight, a stretch holding the autumn clock change is an hour
 * longer, and the routes capped at a bare 62 × 24 h — so a page opened just
 * after midnight with the widest window got 400 for every unseeded service,
 * every night for eight weeks. This pins one to the other.
 */
const ZONES = [
  'Europe/Oslo',
  'America/New_York',
  'Australia/Sydney',
  // Half-hour DST.
  'Australia/Lord_Howe',
  'Pacific/Auckland',
  'UTC',
];
const DAYPARTS = [{ key: 'day', from: 0, to: 24 }];

function admitted(fromTs: number, toTs: number): boolean {
  const parsed = parseRange(new URLSearchParams({ from_ts: String(fromTs), to_ts: String(toTs) }));
  return !('error' in parsed);
}

describe('the read routes admit every window a valid config can build', () => {
  it.each(ZONES)(
    'the widest window, opened one second after any midnight of 2026–2027, in %s',
    (timeZone) => {
      const clock = createClock({ timeZone, locale: 'en-GB', dayparts: DAYPARTS });
      const refused: string[] = [];
      const end = Date.parse('2028-01-01T00:00:00Z');
      // The span is longest straight after a business midnight.
      let fromTs = clock.dayStart(Date.parse('2026-01-01T12:00:00Z')) + 1000;
      while (fromTs < end) {
        const { toTs, days } = clock.window(fromTs, MAX_RANGE_DAYS);
        if (!admitted(fromTs, toTs)) refused.push(new Date(fromTs).toISOString());
        fromTs = days[1] + 1000;
      }
      expect(refused).toEqual([]);
    },
    // 730 days of `Intl` arithmetic per zone.
    30_000
  );

  it('still refuses a range past the bound', () => {
    expect(admitted(0, MAX_RANGE_MS)).toBe(true);
    expect(admitted(0, MAX_RANGE_MS + 1)).toBe(false);
  });
});

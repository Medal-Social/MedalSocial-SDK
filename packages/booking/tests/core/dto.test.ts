import { describe, expect, it } from 'vitest';
import { createDto } from '../../src/core/dto';
import type { MedalScheduleDay } from '../../src/core/wire';
import { PARITY_CONFIG } from '../support/parity-config';

const { toBookingDayDto, toBookingResourceDto, toBookingServiceDto } = createDto(PARITY_CONFIG);

/**
 * Tested here rather than only through `/api/booking/schedule`, because the
 * route cannot see the difference this function exists to make.
 *
 * `NextResponse.json` serialises `NaN` as `null`, so an assertion taken off the
 * response body reads a NaN `lastStartTs` and a deliberate null one as the same
 * value — and the guard that produces the null could be deleted with every
 * route test still green. `toBookingDayDto` returns real JS, where they differ.
 */
describe('toBookingDayDto', () => {
  const READABLE: MedalScheduleDay = {
    date: '2026-09-02',
    opens_ts: '2026-09-02T08:00:00.000Z',
    closes_ts: '2026-09-02T15:00:00.000Z',
    last_start_ts: '2026-09-02T14:30:00.000Z',
  };

  it('turns the wire shape into epoch milliseconds, keeping the salon’s date key', () => {
    expect(toBookingDayDto(READABLE)).toEqual([
      {
        dayKey: '2026-09-02',
        opensTs: Date.UTC(2026, 8, 2, 8),
        closesTs: Date.UTC(2026, 8, 2, 15),
        lastStartTs: Date.UTC(2026, 8, 2, 14, 30),
      },
    ]);
  });

  it('keeps a null last start, which means shut on the day rather than missing', () => {
    expect(toBookingDayDto({ ...READABLE, last_start_ts: null })[0].lastStartTs).toBeNull();
  });

  it('turns an unreadable last start into null and never into NaN', () => {
    // NaN would be worse than either answer available. `null` already means
    // «shut on the day», which is the conservative thing to say about a value
    // we cannot read and a case step 3 handles; NaN compares false against
    // every clock check it makes, so the day would fall through to «Fullt».
    const [day] = toBookingDayDto({ ...READABLE, last_start_ts: 'not a date' });

    expect(day.lastStartTs).toBeNull();
    expect(Number.isNaN(day.lastStartTs)).toBe(false);
  });

  it('drops a day with no date, however readable its hours are', () => {
    // Without the date there is nothing to file it under: `dayKey` is what step
    // 3 looks a day up by, and a day nobody can look up is a day that silently
    // never applies.
    expect(toBookingDayDto({ ...READABLE, date: null })).toEqual([]);
  });

  it('drops a day whose bounds cannot be read, rather than emitting NaN', () => {
    // The asymmetry that decides this: a dropped day reads as «the salon keeps
    // no hours then» and shows «Stengt» — visible, and a tap wasted. A NaN
    // `opensTs` reads as OPEN and falls through to «Fullt», which is the false
    // claim about the business the schedule was added to stop.
    expect(toBookingDayDto({ ...READABLE, opens_ts: null })).toEqual([]);
    expect(toBookingDayDto({ ...READABLE, closes_ts: 'not a date' })).toEqual([]);
  });
});

describe('toBookingResourceDto photo', () => {
  const base = { name: 'Sara', bio: null, service_ids: [], sort_order: 1 };

  it('points at this site’s avatar proxy, never the presigned URL', () => {
    const dto = toBookingResourceDto({
      ...base,
      id: 'res-1',
      photo_url: 'https://r2.example.com/a.png?X-Amz-Signature=x',
    });
    expect(dto.photoUrl).toBe('/api/booking/avatar/res-1');
  });

  it('has no photo when Medal has none, or the id is one the proxy would refuse', () => {
    expect(toBookingResourceDto({ ...base, id: 'res-1', photo_url: null }).photoUrl).toBeNull();
    expect(
      toBookingResourceDto({ ...base, id: 'res/1', photo_url: 'https://r2.example.com/a.png' })
        .photoUrl
    ).toBeNull();
  });
});

describe('toBookingServiceDto age range (SP10)', () => {
  const base = {
    id: 'svc-bhg',
    name: 'Barnehageklipp',
    description: null,
    category: 'barn',
    duration_minutes: 20,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    price_ore: 35_000,
    bookable_online: true,
    max_per_booking: 3,
    weekend_surcharge_pct: 0,
  };

  it('carries the range when Medal sends one', () => {
    const dto = toBookingServiceDto({ ...base, age_min_years: 1, age_max_years: 6 });
    expect(dto.ageMinYears).toBe(1);
    expect(dto.ageMaxYears).toBe(6);
  });

  it('leaves the keys absent — not null — for no range, nonsense, or a Medal without it', () => {
    for (const dto of [
      toBookingServiceDto(base),
      toBookingServiceDto({ ...base, age_min_years: null, age_max_years: null }),
      toBookingServiceDto({ ...base, age_min_years: -1, age_max_years: 6.5 }),
    ]) {
      expect(dto).not.toHaveProperty('ageMinYears');
      expect(dto).not.toHaveProperty('ageMaxYears');
    }
  });
});

/**
 * The ordering hours engine (`src/core/hours.ts`, the Medal API's own engine):
 * kitchen and channel windows, channel state precedence, pickup/delivery slots
 * across DST. Ported case for case from the API's own tests; only the import
 * differs.
 */
import { describe, expect, it } from 'vitest';
import {
  type Channel,
  channelState,
  DEFAULT_TIME_ZONE,
  type EngineInput,
  effectivePreorderDays,
  type HoursPeriod,
  type LocationHours,
  type OrderingSettings,
  parsePeriods,
  prepMinutes,
  serviceDayEnd,
  slots,
  slotsForDate,
} from '../../src/core/hours';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const t = (iso: string) => Date.parse(iso);
const MIN = 60_000;

function everyDay(open: string, close: string): HoursPeriod[] {
  return DAYS.map((day) => ({ openDay: day, openTime: open, closeDay: day, closeTime: close }));
}

const SETTINGS: OrderingSettings = {
  channels: { dineIn: true, takeaway: true, delivery: true },
  cutoffMinutes: 20,
  defaultPrepMinutes: 15,
  preorderDays: 2,
  slotMinutes: 15,
  hasDeliveryVenue: true,
};

function input(
  hours: Partial<LocationHours> = {},
  settings: Partial<OrderingSettings> = {}
): EngineInput {
  return {
    hours: { regular: everyDay('11:00', '22:00'), ...hours },
    settings: { ...SETTINGS, ...settings },
    timeZone: DEFAULT_TIME_ZONE,
  };
}

function osloClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

function clockIn(timeZone: string, ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

const osloDates = (list: { start: number }[]) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' });
  return [...new Set(list.map((s) => fmt.format(s.start)))];
};

const ALWAYS: HoursPeriod[] = DAYS.map((day, i) => ({
  openDay: day,
  openTime: '00:00',
  closeDay: DAYS[(i + 1) % 7],
  closeTime: '00:00',
}));

function expectSteady(list: { start: number; end: number }[]) {
  for (let i = 1; i < list.length; i++) {
    expect(list[i].start - list[i - 1].start).toBe(15 * MIN);
  }
  expect(new Set(list.map((s) => s.start)).size).toBe(list.length);
  for (const s of list) expect(s.end - s.start).toBe(15 * MIN);
}

// 2026-10-21 is a Wednesday (CEST, +02:00).
describe('channelState', () => {
  it('open mid-period', () => {
    expect(channelState(input(), 'dineIn', t('2026-10-21T15:00:00+02:00'))).toEqual({
      open: true,
      closesAt: t('2026-10-21T22:00:00+02:00'),
      lastOrderAt: t('2026-10-21T21:40:00+02:00'),
    });
  });

  it('closed before open', () => {
    const state = channelState(input(), 'takeaway', t('2026-10-21T09:00:00+02:00'));
    expect(state).toEqual({
      open: false,
      reason: 'kitchen_closed',
      opensAt: t('2026-10-21T11:00:00+02:00'),
    });
  });

  it('cutoff 20 min before close', () => {
    expect(channelState(input(), 'takeaway', t('2026-10-21T21:39:00+02:00')).open).toBe(true);
    expect(channelState(input(), 'takeaway', t('2026-10-21T21:45:00+02:00'))).toEqual({
      open: false,
      reason: 'cutoff',
      closesAt: t('2026-10-21T22:00:00+02:00'),
      lastOrderAt: t('2026-10-21T21:40:00+02:00'),
      opensAt: t('2026-10-22T11:00:00+02:00'),
    });
  });

  it('overnight 18:00-02:00 open at 01:00 Sunday', () => {
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '18:00', closeDay: 'SUNDAY', closeTime: '02:00' }],
    };
    expect(channelState(input(hours), 'dineIn', t('2026-10-18T01:00:00+02:00'))).toEqual({
      open: true,
      closesAt: t('2026-10-18T02:00:00+02:00'),
      lastOrderAt: t('2026-10-18T01:40:00+02:00'),
    });
    // Same-day close <= open is overnight too.
    const sameDay = {
      regular: [
        { openDay: 'SATURDAY', openTime: '18:00', closeDay: 'SATURDAY', closeTime: '02:00' },
      ],
    };
    expect(channelState(input(sameDay), 'dineIn', t('2026-10-18T01:00:00+02:00')).open).toBe(true);
  });

  it('closeTime 24:00 means end of day', () => {
    const hours = { regular: everyDay('18:00', '24:00') };
    expect(channelState(input(hours), 'dineIn', t('2026-10-21T23:00:00+02:00')).closesAt).toBe(
      t('2026-10-22T00:00:00+02:00')
    );
  });

  it('special day closed overrides regular', () => {
    const hours = { special: [{ date: '2026-10-21', closed: true }] };
    expect(channelState(input(hours), 'takeaway', t('2026-10-21T15:00:00+02:00'))).toEqual({
      open: false,
      reason: 'closed',
      opensAt: t('2026-10-22T11:00:00+02:00'),
    });
  });

  it('special day short hours', () => {
    const hours = {
      special: [{ date: '2026-10-21', closed: false, openTime: '12:00', closeTime: '16:00' }],
    };
    expect(channelState(input(hours), 'dineIn', t('2026-10-21T15:00:00+02:00')).closesAt).toBe(
      t('2026-10-21T16:00:00+02:00')
    );
    expect(channelState(input(hours), 'dineIn', t('2026-10-21T17:00:00+02:00'))).toMatchObject({
      open: false,
      reason: 'kitchen_closed',
      opensAt: t('2026-10-22T11:00:00+02:00'),
    });
  });

  it('delivery hours clamped to kitchen hours', () => {
    const wide = { more: { delivery: everyDay('10:00', '23:00') } };
    expect(channelState(input(wide), 'delivery', t('2026-10-21T10:30:00+02:00')).reason).toBe(
      'kitchen_closed'
    );
    expect(channelState(input(wide), 'delivery', t('2026-10-21T15:00:00+02:00')).closesAt).toBe(
      t('2026-10-21T22:00:00+02:00')
    );
    const narrow = { more: { delivery: everyDay('16:00', '21:00') } };
    expect(channelState(input(narrow), 'delivery', t('2026-10-21T12:00:00+02:00'))).toEqual({
      open: false,
      reason: 'closed',
      opensAt: t('2026-10-21T16:00:00+02:00'),
    });
    // Takeaway without its own hours follows the kitchen.
    expect(channelState(input(narrow), 'takeaway', t('2026-10-21T12:00:00+02:00')).open).toBe(true);
  });

  it('special day with hours clamps channel hours', () => {
    const hours = {
      special: [{ date: '2026-10-21', closed: false, openTime: '12:00', closeTime: '18:00' }],
      more: { delivery: everyDay('16:00', '21:00') },
    };
    expect(channelState(input(hours), 'delivery', t('2026-10-21T17:00:00+02:00')).closesAt).toBe(
      t('2026-10-21T18:00:00+02:00')
    );
  });

  it('pause until 19:30 reopens at 19:30', () => {
    const until = t('2026-10-21T19:30:00+02:00');
    const settings = { pause: { channels: ['takeaway' as Channel], until } };
    expect(channelState(input({}, settings), 'takeaway', t('2026-10-21T19:00:00+02:00'))).toEqual({
      open: false,
      reason: 'paused',
      opensAt: until,
    });
    expect(channelState(input({}, settings), 'takeaway', until).open).toBe(true);
    expect(channelState(input({}, settings), 'dineIn', t('2026-10-21T19:00:00+02:00')).open).toBe(
      true
    );
  });

  it('pause without until has no opensAt', () => {
    const settings = { pause: { channels: ['delivery' as Channel] } };
    expect(channelState(input({}, settings), 'delivery', t('2026-10-21T19:00:00+02:00'))).toEqual({
      open: false,
      reason: 'paused',
    });
  });

  it('switched-off channel is closed, delivery says delivery_off', () => {
    const settings = { channels: { dineIn: true, takeaway: false, delivery: false } };
    const at = t('2026-10-21T15:00:00+02:00');
    expect(channelState(input({}, settings), 'takeaway', at)).toEqual({
      open: false,
      reason: 'closed',
    });
    expect(channelState(input({}, settings), 'delivery', at)).toEqual({
      open: false,
      reason: 'delivery_off',
    });
  });

  it('delivery without venue is delivery_off, after pause and cutoff', () => {
    const at = t('2026-10-21T15:00:00+02:00');
    expect(channelState(input({}, { hasDeliveryVenue: false }), 'delivery', at)).toEqual({
      open: false,
      reason: 'delivery_off',
    });
    const paused = { hasDeliveryVenue: false, pause: { channels: ['delivery' as Channel] } };
    expect(channelState(input({}, paused), 'delivery', at).reason).toBe('paused');
    expect(
      channelState(
        input({}, { hasDeliveryVenue: false }),
        'delivery',
        t('2026-10-21T21:50:00+02:00')
      ).reason
    ).toBe('cutoff');
  });

  it('kitchen_closed wins over channel closed outside kitchen hours', () => {
    const hours = { more: { takeaway: everyDay('16:00', '21:00') } };
    expect(channelState(input(hours), 'takeaway', t('2026-10-21T08:00:00+02:00')).reason).toBe(
      'kitchen_closed'
    );
  });
});

describe('slots', () => {
  it('starts after prep, aligned, and stops at cutoff', () => {
    const list = slots(input(), 'takeaway', t('2026-10-21T21:00:00+02:00'), 1);
    expect(list.map((s) => osloClock(s.start))).toEqual(['21:15', '21:30']);
  });

  it('aligns an odd start up to the next boundary', () => {
    const list = slots(input(), 'takeaway', t('2026-10-21T20:52:00+02:00'), 1);
    expect(osloClock(list[0].start)).toBe('21:15');
  });

  it('covers preorder days only', () => {
    const list = slots(input(), 'takeaway', t('2026-10-21T21:00:00+02:00'), 7);
    const osloDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' });
    const days = new Set(list.map((s) => osloDate.format(s.start)));
    expect([...days]).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('DST spring-forward day slots skip 02:00-03:00', () => {
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '22:00', closeDay: 'SUNDAY', closeTime: '05:00' }],
    };
    const list = slots(
      input(hours, { defaultPrepMinutes: 0 }),
      'takeaway',
      t('2027-03-27T21:00:00+01:00'),
      2
    );
    const clocks = list.map((s) => osloClock(s.start));
    expect(clocks[0]).toBe('22:00');
    expect(clocks.at(-1)).toBe('04:30');
    expect(clocks.some((c) => c.startsWith('02:'))).toBe(false);
    expect(clocks).toContain('01:45');
    expect(clocks).toContain('03:00');
    expect(list).toHaveLength(16 + 7);
    expectSteady(list);
  });

  it('DST fall-back day no duplicate slots', () => {
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '22:00', closeDay: 'SUNDAY', closeTime: '05:00' }],
    };
    const list = slots(
      input(hours, { defaultPrepMinutes: 0 }),
      'takeaway',
      t('2026-10-24T21:00:00+02:00'),
      2
    );
    expect(list[0].start).toBe(t('2026-10-24T22:00:00+02:00'));
    expect(list.at(-1)?.start).toBe(t('2026-10-25T04:30:00+01:00'));
    // 8 real hours (22:00 CEST to 05:00 CET); last aligned start before the 04:40 cutoff.
    expect(list).toHaveLength(31);
    expectSteady(list);
  });

  it('pause until 19:30 delays the first slot', () => {
    const until = t('2026-10-21T19:30:00+02:00');
    const settings = { pause: { channels: ['takeaway' as Channel], until } };
    const list = slots(input({}, settings), 'takeaway', t('2026-10-21T19:00:00+02:00'), 1);
    expect(list[0].start).toBe(until);
    expect(
      slots(
        input({}, { pause: { channels: ['takeaway'] } }),
        'takeaway',
        t('2026-10-21T19:00:00+02:00'),
        1
      )
    ).toEqual([]);
  });

  it('busy +30 shifts first slot', () => {
    const from = t('2026-10-21T15:00:00+02:00');
    expect(slots(input(), 'takeaway', from, 1)[0].start).toBe(t('2026-10-21T15:15:00+02:00'));
    const busy = { busy: { extraMinutes: 30 } };
    expect(slots(input({}, busy), 'takeaway', from, 1)[0].start).toBe(
      t('2026-10-21T15:45:00+02:00')
    );
    const expired = { busy: { extraMinutes: 30, until: from } };
    expect(slots(input({}, expired), 'takeaway', from, 1)[0].start).toBe(
      t('2026-10-21T15:15:00+02:00')
    );
  });

  it('never offers a slot at close minus cutoff (same rule as channelState)', () => {
    const from = t('2026-10-21T15:00:00+02:00');
    const noCutoff = slots(input({}, { cutoffMinutes: 0 }), 'takeaway', from, 1);
    expect(osloClock(noCutoff[noCutoff.length - 1].start)).toBe('21:45');
    const onBoundary = slots(input({}, { cutoffMinutes: 30 }), 'takeaway', from, 1);
    const last = onBoundary[onBoundary.length - 1].start;
    expect(osloClock(last)).toBe('21:15');
    expect(channelState(input({}, { cutoffMinutes: 30 }), 'takeaway', last).open).toBe(true);
    const dated = slotsForDate(input({}, { cutoffMinutes: 0 }), 'takeaway', '2026-10-22', from);
    expect(osloClock(dated[dated.length - 1].start)).toBe('21:45');
  });

  it('is empty for an off channel or delivery without venue', () => {
    const from = t('2026-10-21T15:00:00+02:00');
    expect(
      slots(
        input({}, { channels: { dineIn: true, takeaway: false, delivery: true } }),
        'takeaway',
        from,
        1
      )
    ).toEqual([]);
    expect(slots(input({}, { hasDeliveryVenue: false }), 'delivery', from, 1)).toEqual([]);
  });
});

describe('prepMinutes', () => {
  it('adds busy minutes while busy is active', () => {
    const at = t('2026-10-21T15:00:00+02:00');
    expect(prepMinutes({ defaultPrepMinutes: 15 }, at)).toBe(15);
    expect(prepMinutes({ defaultPrepMinutes: 15, busy: { extraMinutes: 30 } }, at)).toBe(45);
    expect(
      prepMinutes({ defaultPrepMinutes: 15, busy: { extraMinutes: 30, until: at + 1 } }, at)
    ).toBe(45);
    expect(prepMinutes({ defaultPrepMinutes: 15, busy: { extraMinutes: 30, until: at } }, at)).toBe(
      15
    );
  });
});

describe('serviceDayEnd', () => {
  it('serviceDayEnd overnight', () => {
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '18:00', closeDay: 'SUNDAY', closeTime: '02:00' }],
    };
    const tz = { hours, timeZone: DEFAULT_TIME_ZONE };
    const end = t('2026-10-18T02:00:00+02:00');
    expect(serviceDayEnd(tz, t('2026-10-17T20:00:00+02:00'))).toBe(end);
    expect(serviceDayEnd(tz, t('2026-10-18T01:00:00+02:00'))).toBe(end);
    expect(serviceDayEnd(tz, t('2026-10-17T10:00:00+02:00'))).toBe(end);
  });

  it('falls back to the next local midnight', () => {
    const tz = { hours: { regular: everyDay('11:00', '22:00') }, timeZone: DEFAULT_TIME_ZONE };
    expect(serviceDayEnd(tz, t('2026-10-21T23:00:00+02:00'))).toBe(t('2026-10-22T00:00:00+02:00'));
  });
});

describe('parsePeriods', () => {
  it('returns sorted, merged absolute windows over the range', () => {
    const periods: HoursPeriod[] = [
      { openDay: 'WEDNESDAY', openTime: '16:00', closeDay: 'WEDNESDAY', closeTime: '22:00' },
      { openDay: 'WEDNESDAY', openTime: '11:00', closeDay: 'WEDNESDAY', closeTime: '14:00' },
      { openDay: 'WEDNESDAY', openTime: '13:00', closeDay: 'WEDNESDAY', closeTime: '16:00' },
    ];
    expect(
      parsePeriods(
        periods,
        undefined,
        DEFAULT_TIME_ZONE,
        t('2026-10-21T00:00:00+02:00'),
        t('2026-10-22T00:00:00+02:00')
      )
    ).toEqual([{ start: t('2026-10-21T11:00:00+02:00'), end: t('2026-10-21T22:00:00+02:00') }]);
  });
});

describe('review edge cases', () => {
  it('24/7 hours: open without a known close, service day ends at next midnight', () => {
    const at = t('2026-10-21T15:00:00+02:00');
    expect(channelState(input({ regular: ALWAYS }), 'dineIn', at)).toEqual({ open: true });
    expect(serviceDayEnd({ hours: { regular: ALWAYS }, timeZone: DEFAULT_TIME_ZONE }, at)).toBe(
      t('2026-10-22T00:00:00+02:00')
    );
  });

  it('special day closed:false without times keeps regular hours', () => {
    const hours = { special: [{ date: '2026-10-21', closed: false }] };
    expect(channelState(input(hours), 'dineIn', t('2026-10-21T15:00:00+02:00')).closesAt).toBe(
      t('2026-10-21T22:00:00+02:00')
    );
  });

  it('clamps days and preorderDays', () => {
    const from = t('2026-10-21T08:00:00+02:00');
    expect(osloDates(slots(input(), 'takeaway', from, 2.7))).toEqual(['2026-10-21', '2026-10-22']);
    expect(osloDates(slots(input(), 'takeaway', from, Number.NaN))).toEqual(['2026-10-21']);
    expect(osloDates(slots(input(), 'takeaway', from, 0))).toEqual(['2026-10-21']);
    expect(osloDates(slots(input(), 'takeaway', from, Number.POSITIVE_INFINITY))).toHaveLength(3);
    expect(osloDates(slots(input({}, { preorderDays: 30 }), 'takeaway', from, 99))).toHaveLength(8);
  });

  it('overnight window on the last allowed date keeps its after-midnight slots', () => {
    const list = slots(
      input({ regular: everyDay('18:00', '02:00') }),
      'takeaway',
      t('2026-10-21T17:00:00+02:00'),
      1
    );
    expect(list.at(-1)?.start).toBe(t('2026-10-22T01:30:00+02:00'));
    // Thursday's own window (opening 18:00) is not on an allowed date.
    expect(list.every((s) => s.start < t('2026-10-22T02:00:00+02:00'))).toBe(true);
  });

  it('periods longer than a day are found', () => {
    const regular = [
      { openDay: 'FRIDAY', openTime: '18:00', closeDay: 'SUNDAY', closeTime: '02:00' },
    ];
    const window = { start: t('2026-10-23T18:00:00+02:00'), end: t('2026-10-25T02:00:00+02:00') };
    expect(
      parsePeriods(
        regular,
        undefined,
        DEFAULT_TIME_ZONE,
        t('2026-10-24T12:00:00+02:00'),
        t('2026-10-24T13:00:00+02:00')
      )
    ).toEqual([window]);
    const list = slots(input({ regular }), 'takeaway', t('2026-10-24T12:00:00+02:00'), 1);
    expect(list[0].start).toBe(t('2026-10-24T12:15:00+02:00'));
  });

  it('30-minute DST shift keeps hourly slots on local boundaries (Lord Howe)', () => {
    const timeZone = 'Australia/Lord_Howe';
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '22:00', closeDay: 'SUNDAY', closeTime: '05:00' }],
    };
    const engine = { ...input(hours, { defaultPrepMinutes: 0, slotMinutes: 60 }), timeZone };
    const list = slots(engine, 'takeaway', t('2027-04-03T21:00:00+11:00'), 1);
    expect(list.map((s) => clockIn(timeZone, s.start))).toEqual([
      '22:00',
      '23:00',
      '00:00',
      '01:00',
      '02:00',
      '03:00',
      '04:00',
    ]);
  });
});

describe('slotsForDate', () => {
  // Friday 18:00 to Saturday 02:00 only; 2026-10-23 is a Friday.
  const overnight = {
    regular: [{ openDay: 'FRIDAY', openTime: '18:00', closeDay: 'SATURDAY', closeTime: '02:00' }],
  };
  const FRIDAY_NOON = t('2026-10-23T12:00:00+02:00');

  it('keeps the overnight spill-over on the date the window opens', () => {
    const friday = slotsForDate(input(overnight), 'takeaway', '2026-10-23', FRIDAY_NOON);
    const clocks = friday.map((s) => osloClock(s.start));
    expect(clocks[0]).toBe('18:00');
    expect(clocks).toContain('00:00');
    expect(clocks.at(-1)).toBe('01:30');
    expectSteady(friday);
    expect(slotsForDate(input(overnight), 'takeaway', '2026-10-24', FRIDAY_NOON)).toEqual([]);
  });

  it('today keeps a window that opened yesterday and is still open', () => {
    const now = t('2026-10-24T00:30:00+02:00');
    const saturday = slotsForDate(input(overnight), 'takeaway', '2026-10-24', now);
    expect(saturday.map((s) => osloClock(s.start))).toEqual(['00:45', '01:00', '01:15', '01:30']);
  });

  it('a future date starts at opening, not opening plus prep', () => {
    const list = slotsForDate(input(), 'takeaway', '2026-10-22', t('2026-10-21T21:00:00+02:00'));
    expect(osloClock(list[0].start)).toBe('11:00');
    expect(osloClock(list.at(-1)?.start ?? 0)).toBe('21:30');
    expect(osloDates(list)).toEqual(['2026-10-22']);
  });

  it('today starts after prep and busy', () => {
    const now = t('2026-10-21T15:00:00+02:00');
    const list = slotsForDate(
      input({}, { busy: { extraMinutes: 30 } }),
      'takeaway',
      '2026-10-21',
      now
    );
    expect(list[0].start).toBe(t('2026-10-21T15:45:00+02:00'));
  });

  it('is empty outside today..today + preorder days', () => {
    const now = t('2026-10-21T12:00:00+02:00');
    expect(slotsForDate(input(), 'takeaway', '2026-10-20', now)).toEqual([]);
    expect(slotsForDate(input(), 'takeaway', '2026-10-23', now)).not.toEqual([]);
    expect(slotsForDate(input(), 'takeaway', '2026-10-24', now)).toEqual([]);
    expect(
      slotsForDate(input({}, { preorderDays: 30 }), 'takeaway', '2026-10-28', now)
    ).not.toEqual([]);
    expect(slotsForDate(input({}, { preorderDays: 30 }), 'takeaway', '2026-10-29', now)).toEqual(
      []
    );
  });

  it('honours a timed pause and drops an untimed one', () => {
    const now = t('2026-10-21T19:00:00+02:00');
    const until = t('2026-10-21T19:30:00+02:00');
    const timed = input({}, { pause: { channels: ['takeaway'], until } });
    expect(slotsForDate(timed, 'takeaway', '2026-10-21', now)[0].start).toBe(until);
    const untimed = input({}, { pause: { channels: ['takeaway'] } });
    expect(slotsForDate(untimed, 'takeaway', '2026-10-21', now)).toEqual([]);
    expect(slotsForDate(untimed, 'dineIn', '2026-10-21', now)).not.toEqual([]);
  });

  it('own channel hours clamp to the kitchen', () => {
    const hours = { more: { takeaway: everyDay('12:00', '23:00') } };
    const list = slotsForDate(
      input(hours),
      'takeaway',
      '2026-10-22',
      t('2026-10-21T12:00:00+02:00')
    );
    expect(osloClock(list[0].start)).toBe('12:00');
    expect(osloClock(list.at(-1)?.start ?? 0)).toBe('21:30');
  });

  it('DST fall-back overnight: steady, no duplicate starts', () => {
    const hours = {
      regular: [{ openDay: 'SATURDAY', openTime: '22:00', closeDay: 'SUNDAY', closeTime: '05:00' }],
    };
    const list = slotsForDate(
      input(hours, { defaultPrepMinutes: 0 }),
      'takeaway',
      '2026-10-24',
      t('2026-10-24T12:00:00+02:00')
    );
    expect(list[0].start).toBe(t('2026-10-24T22:00:00+02:00'));
    expect(list.at(-1)?.start).toBe(t('2026-10-25T04:30:00+01:00'));
    expect(list).toHaveLength(31);
    expectSteady(list);
  });
});

describe('effectivePreorderDays', () => {
  it('clamps to whole days 0..7', () => {
    expect([-1, 0, 2.7, 7, 30, Number.NaN].map(effectivePreorderDays)).toEqual([0, 0, 2, 7, 7, 0]);
  });
});

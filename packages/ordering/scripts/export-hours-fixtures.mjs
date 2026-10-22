#!/usr/bin/env node
// Writes tests/fixtures/hours.json: a table of inputs to the hours engine and
// what the engine answers for each, so tests/core/hours.parity.test.ts can hold
// the package's `src/core/hours.ts` to the Medal API's own engine.
//
//   node scripts/export-hours-fixtures.mjs --engine <monorepo>/apps/shared/ordering/hours.ts
//
// `--engine` is the TypeScript file to run: the API's engine to refresh the
// fixture, or `src/core/hours.ts` to show the package answers the same
// (`git diff --exit-code tests/fixtures/hours.json` afterwards). `--out`
// overrides the output path. The types are stripped with esbuild; the engine
// has no imports, so the stripped module runs as it is.
//
// Every number is epoch ms (or minutes/days where the function takes them).
// JSON has no NaN or Infinity, so an input that is one is written as
// `{ "$number": "NaN" }` / `{ "$number": "Infinity" }`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { engine: { type: 'string' }, out: { type: 'string' } },
});
if (!values.engine) {
  console.error('usage: export-hours-fixtures.mjs --engine <path to hours.ts> [--out <file>]');
  process.exit(1);
}
const out = resolve(values.out ?? join(root, 'tests/fixtures/hours.json'));

// --- The input table -----------------------------------------------------------

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TZ = 'Europe/Oslo';
const t = (/** @type {string} */ iso) => Date.parse(iso);

/** @typedef {{ openDay: string, openTime: string, closeDay: string, closeTime: string }} Period */

function everyDay(/** @type {string} */ open, /** @type {string} */ close) {
  return DAYS.map((day) => ({ openDay: day, openTime: open, closeDay: day, closeTime: close }));
}

/** @type {Period[]} */
const ALWAYS = DAYS.map((day, i) => ({
  openDay: day,
  openTime: '00:00',
  closeDay: DAYS[(i + 1) % 7],
  closeTime: '00:00',
}));

const SETTINGS = {
  channels: { dineIn: true, takeaway: true, delivery: true },
  cutoffMinutes: 20,
  defaultPrepMinutes: 15,
  preorderDays: 2,
  slotMinutes: 15,
  hasDeliveryVenue: true,
};

/** An engine input: 11:00–22:00 every day in Oslo unless overridden. */
function input(
  /** @type {Record<string, unknown>} */ hours = {},
  /** @type {Record<string, unknown>} */ settings = {},
  timeZone = TZ
) {
  return {
    hours: { regular: everyDay('11:00', '22:00'), ...hours },
    settings: { ...SETTINGS, ...settings },
    timeZone,
  };
}

const sat22to05 = {
  regular: [{ openDay: 'SATURDAY', openTime: '22:00', closeDay: 'SUNDAY', closeTime: '05:00' }],
};
const sat18to02 = {
  regular: [{ openDay: 'SATURDAY', openTime: '18:00', closeDay: 'SUNDAY', closeTime: '02:00' }],
};
const fri18to02 = {
  regular: [{ openDay: 'FRIDAY', openTime: '18:00', closeDay: 'SATURDAY', closeTime: '02:00' }],
};
const fri18toSun02 = [
  { openDay: 'FRIDAY', openTime: '18:00', closeDay: 'SUNDAY', closeTime: '02:00' },
];

/** @type {{ name: string, fn: string, args: unknown[] }[]} */
const cases = [];
const add = (
  /** @type {string} */ name,
  /** @type {string} */ fn,
  /** @type {unknown[]} */ ...args
) => cases.push({ name, fn, args });

// The API's own unit tests, call for call. 2026-10-21 is a Wednesday (CEST).
add('open mid-period', 'channelState', input(), 'dineIn', t('2026-10-21T15:00:00+02:00'));
add('closed before open', 'channelState', input(), 'takeaway', t('2026-10-21T09:00:00+02:00'));
add('cutoff: just before', 'channelState', input(), 'takeaway', t('2026-10-21T21:39:00+02:00'));
add('cutoff: inside', 'channelState', input(), 'takeaway', t('2026-10-21T21:45:00+02:00'));
add(
  'overnight Sat 18–Sun 02 at 01:00',
  'channelState',
  input(sat18to02),
  'dineIn',
  t('2026-10-18T01:00:00+02:00')
);
add(
  'overnight with a same-day close',
  'channelState',
  input({
    regular: [{ openDay: 'SATURDAY', openTime: '18:00', closeDay: 'SATURDAY', closeTime: '02:00' }],
  }),
  'dineIn',
  t('2026-10-18T01:00:00+02:00')
);
add(
  'closeTime 24:00',
  'channelState',
  input({ regular: everyDay('18:00', '24:00') }),
  'dineIn',
  t('2026-10-21T23:00:00+02:00')
);
const specialClosed = { special: [{ date: '2026-10-21', closed: true }] };
add(
  'special day closed',
  'channelState',
  input(specialClosed),
  'takeaway',
  t('2026-10-21T15:00:00+02:00')
);
const specialShort = {
  special: [{ date: '2026-10-21', closed: false, openTime: '12:00', closeTime: '16:00' }],
};
add(
  'special short hours: inside',
  'channelState',
  input(specialShort),
  'dineIn',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'special short hours: after',
  'channelState',
  input(specialShort),
  'dineIn',
  t('2026-10-21T17:00:00+02:00')
);
const wideDelivery = { more: { delivery: everyDay('10:00', '23:00') } };
const narrowDelivery = { more: { delivery: everyDay('16:00', '21:00') } };
add(
  'delivery wider than kitchen: early',
  'channelState',
  input(wideDelivery),
  'delivery',
  t('2026-10-21T10:30:00+02:00')
);
add(
  'delivery wider than kitchen: mid',
  'channelState',
  input(wideDelivery),
  'delivery',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'delivery narrower than kitchen',
  'channelState',
  input(narrowDelivery),
  'delivery',
  t('2026-10-21T12:00:00+02:00')
);
add(
  'takeaway follows the kitchen',
  'channelState',
  input(narrowDelivery),
  'takeaway',
  t('2026-10-21T12:00:00+02:00')
);
add(
  'special hours clamp channel hours',
  'channelState',
  input({
    special: [{ date: '2026-10-21', closed: false, openTime: '12:00', closeTime: '18:00' }],
    more: { delivery: everyDay('16:00', '21:00') },
  }),
  'delivery',
  t('2026-10-21T17:00:00+02:00')
);
const pauseUntil = t('2026-10-21T19:30:00+02:00');
const timedPause = { pause: { channels: ['takeaway'], until: pauseUntil } };
add(
  'timed pause: paused',
  'channelState',
  input({}, timedPause),
  'takeaway',
  t('2026-10-21T19:00:00+02:00')
);
add('timed pause: at until', 'channelState', input({}, timedPause), 'takeaway', pauseUntil);
add(
  'timed pause: other channel',
  'channelState',
  input({}, timedPause),
  'dineIn',
  t('2026-10-21T19:00:00+02:00')
);
add(
  'untimed pause',
  'channelState',
  input({}, { pause: { channels: ['delivery'] } }),
  'delivery',
  t('2026-10-21T19:00:00+02:00')
);
const offChannels = { channels: { dineIn: true, takeaway: false, delivery: false } };
add(
  'channel off',
  'channelState',
  input({}, offChannels),
  'takeaway',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'delivery off',
  'channelState',
  input({}, offChannels),
  'delivery',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'no delivery venue',
  'channelState',
  input({}, { hasDeliveryVenue: false }),
  'delivery',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'no delivery venue, paused',
  'channelState',
  input({}, { hasDeliveryVenue: false, pause: { channels: ['delivery'] } }),
  'delivery',
  t('2026-10-21T15:00:00+02:00')
);
add(
  'no delivery venue, cutoff',
  'channelState',
  input({}, { hasDeliveryVenue: false }),
  'delivery',
  t('2026-10-21T21:50:00+02:00')
);
add(
  'kitchen_closed before channel closed',
  'channelState',
  input({ more: { takeaway: everyDay('16:00', '21:00') } }),
  'takeaway',
  t('2026-10-21T08:00:00+02:00')
);

add(
  'slots after prep, stop at cutoff',
  'slots',
  input(),
  'takeaway',
  t('2026-10-21T21:00:00+02:00'),
  1
);
add('slots from an odd minute', 'slots', input(), 'takeaway', t('2026-10-21T20:52:00+02:00'), 1);
add(
  'slots over preorder days only',
  'slots',
  input(),
  'takeaway',
  t('2026-10-21T21:00:00+02:00'),
  7
);
add(
  'slots across DST spring-forward',
  'slots',
  input(sat22to05, { defaultPrepMinutes: 0 }),
  'takeaway',
  t('2027-03-27T21:00:00+01:00'),
  2
);
add(
  'slots across DST fall-back',
  'slots',
  input(sat22to05, { defaultPrepMinutes: 0 }),
  'takeaway',
  t('2026-10-24T21:00:00+02:00'),
  2
);
add(
  'slots after a timed pause',
  'slots',
  input({}, timedPause),
  'takeaway',
  t('2026-10-21T19:00:00+02:00'),
  1
);
add(
  'slots under an untimed pause',
  'slots',
  input({}, { pause: { channels: ['takeaway'] } }),
  'takeaway',
  t('2026-10-21T19:00:00+02:00'),
  1
);
const fifteen = t('2026-10-21T15:00:00+02:00');
add('slots: plain prep', 'slots', input(), 'takeaway', fifteen, 1);
add('slots: busy +30', 'slots', input({}, { busy: { extraMinutes: 30 } }), 'takeaway', fifteen, 1);
add(
  'slots: busy expired',
  'slots',
  input({}, { busy: { extraMinutes: 30, until: fifteen } }),
  'takeaway',
  fifteen,
  1
);
add('slots: no cutoff', 'slots', input({}, { cutoffMinutes: 0 }), 'takeaway', fifteen, 1);
add(
  'slots: cutoff on a boundary',
  'slots',
  input({}, { cutoffMinutes: 30 }),
  'takeaway',
  fifteen,
  1
);
add(
  'last slot is still open',
  'channelState',
  input({}, { cutoffMinutes: 30 }),
  'takeaway',
  t('2026-10-21T21:15:00+02:00')
);
add(
  'slotsForDate: no cutoff',
  'slotsForDate',
  input({}, { cutoffMinutes: 0 }),
  'takeaway',
  '2026-10-22',
  fifteen
);
add(
  'slots: channel off',
  'slots',
  input({}, { channels: { dineIn: true, takeaway: false, delivery: true } }),
  'takeaway',
  fifteen,
  1
);
add(
  'slots: no delivery venue',
  'slots',
  input({}, { hasDeliveryVenue: false }),
  'delivery',
  fifteen,
  1
);

add('prepMinutes: plain', 'prepMinutes', { defaultPrepMinutes: 15 }, fifteen);
add(
  'prepMinutes: busy',
  'prepMinutes',
  { defaultPrepMinutes: 15, busy: { extraMinutes: 30 } },
  fifteen
);
add(
  'prepMinutes: busy until later',
  'prepMinutes',
  { defaultPrepMinutes: 15, busy: { extraMinutes: 30, until: fifteen + 1 } },
  fifteen
);
add(
  'prepMinutes: busy ended',
  'prepMinutes',
  { defaultPrepMinutes: 15, busy: { extraMinutes: 30, until: fifteen } },
  fifteen
);

const overnightService = { hours: sat18to02, timeZone: TZ };
add(
  'serviceDayEnd overnight: evening',
  'serviceDayEnd',
  overnightService,
  t('2026-10-17T20:00:00+02:00')
);
add(
  'serviceDayEnd overnight: after midnight',
  'serviceDayEnd',
  overnightService,
  t('2026-10-18T01:00:00+02:00')
);
add(
  'serviceDayEnd overnight: morning',
  'serviceDayEnd',
  overnightService,
  t('2026-10-17T10:00:00+02:00')
);
add(
  'serviceDayEnd falls back to midnight',
  'serviceDayEnd',
  { hours: { regular: everyDay('11:00', '22:00') }, timeZone: TZ },
  t('2026-10-21T23:00:00+02:00')
);

add(
  'parsePeriods sorts and merges',
  'parsePeriods',
  [
    { openDay: 'WEDNESDAY', openTime: '16:00', closeDay: 'WEDNESDAY', closeTime: '22:00' },
    { openDay: 'WEDNESDAY', openTime: '11:00', closeDay: 'WEDNESDAY', closeTime: '14:00' },
    { openDay: 'WEDNESDAY', openTime: '13:00', closeDay: 'WEDNESDAY', closeTime: '16:00' },
  ],
  undefined,
  TZ,
  t('2026-10-21T00:00:00+02:00'),
  t('2026-10-22T00:00:00+02:00')
);

add('24/7 channel state', 'channelState', input({ regular: ALWAYS }), 'dineIn', fifteen);
add('24/7 service day', 'serviceDayEnd', { hours: { regular: ALWAYS }, timeZone: TZ }, fifteen);
add(
  'special day open without times',
  'channelState',
  input({ special: [{ date: '2026-10-21', closed: false }] }),
  'dineIn',
  fifteen
);
const eight = t('2026-10-21T08:00:00+02:00');
add('slots: days 2.7', 'slots', input(), 'takeaway', eight, 2.7);
add('slots: days NaN', 'slots', input(), 'takeaway', eight, Number.NaN);
add('slots: days 0', 'slots', input(), 'takeaway', eight, 0);
add('slots: days Infinity', 'slots', input(), 'takeaway', eight, Number.POSITIVE_INFINITY);
add('slots: preorder 30, days 99', 'slots', input({}, { preorderDays: 30 }), 'takeaway', eight, 99);
add(
  'slots: overnight on the last date',
  'slots',
  input({ regular: everyDay('18:00', '02:00') }),
  'takeaway',
  t('2026-10-21T17:00:00+02:00'),
  1
);
add(
  'parsePeriods: longer than a day',
  'parsePeriods',
  fri18toSun02,
  undefined,
  TZ,
  t('2026-10-24T12:00:00+02:00'),
  t('2026-10-24T13:00:00+02:00')
);
add(
  'slots: inside a two-day period',
  'slots',
  input({ regular: fri18toSun02 }),
  'takeaway',
  t('2026-10-24T12:00:00+02:00'),
  1
);
// The last night of a period opened two and six days earlier (the look-back).
const monToSun = [{ openDay: 'MONDAY', openTime: '10:00', closeDay: 'SUNDAY', closeTime: '22:00' }];
for (const [label, periods] of /** @type {[string, Period[]][]} */ ([
  ['two-day', fri18toSun02],
  ['six-day', monToSun],
])) {
  const sundayEarly = t('2026-10-25T00:30:00+02:00');
  add(
    `parsePeriods: last night of a ${label} period`,
    'parsePeriods',
    periods,
    undefined,
    TZ,
    sundayEarly,
    sundayEarly + 3_600_000
  );
  add(
    `slots: last night of a ${label} period`,
    'slots',
    input({ regular: periods }),
    'takeaway',
    sundayEarly,
    1
  );
  add(
    `slotsForDate: last night of a ${label} period`,
    'slotsForDate',
    input({ regular: periods }),
    'takeaway',
    '2026-10-25',
    sundayEarly
  );
  add(
    `serviceDayEnd: last night of a ${label} period`,
    'serviceDayEnd',
    input({ regular: periods }),
    sundayEarly
  );
  add(
    `channelState: last night of a ${label} period`,
    'channelState',
    input({ regular: periods }),
    'dineIn',
    sundayEarly
  );
}
add(
  'slots: 30-minute DST shift (Lord Howe)',
  'slots',
  input(sat22to05, { defaultPrepMinutes: 0, slotMinutes: 60 }, 'Australia/Lord_Howe'),
  'takeaway',
  t('2027-04-03T21:00:00+11:00'),
  1
);

const fridayNoon = t('2026-10-23T12:00:00+02:00');
add(
  'slotsForDate: overnight on its opening date',
  'slotsForDate',
  input(fri18to02),
  'takeaway',
  '2026-10-23',
  fridayNoon
);
add(
  'slotsForDate: not on the next date',
  'slotsForDate',
  input(fri18to02),
  'takeaway',
  '2026-10-24',
  fridayNoon
);
add(
  'slotsForDate: today keeps last night',
  'slotsForDate',
  input(fri18to02),
  'takeaway',
  '2026-10-24',
  t('2026-10-24T00:30:00+02:00')
);
add(
  'slotsForDate: a future date starts at opening',
  'slotsForDate',
  input(),
  'takeaway',
  '2026-10-22',
  t('2026-10-21T21:00:00+02:00')
);
add(
  'slotsForDate: today after prep and busy',
  'slotsForDate',
  input({}, { busy: { extraMinutes: 30 } }),
  'takeaway',
  '2026-10-21',
  fifteen
);
const noon = t('2026-10-21T12:00:00+02:00');
for (const date of ['2026-10-20', '2026-10-23', '2026-10-24']) {
  add(`slotsForDate: range ${date}`, 'slotsForDate', input(), 'takeaway', date, noon);
}
for (const date of ['2026-10-28', '2026-10-29']) {
  add(
    `slotsForDate: preorder 30, ${date}`,
    'slotsForDate',
    input({}, { preorderDays: 30 }),
    'takeaway',
    date,
    noon
  );
}
const nineteen = t('2026-10-21T19:00:00+02:00');
add(
  'slotsForDate: timed pause',
  'slotsForDate',
  input({}, timedPause),
  'takeaway',
  '2026-10-21',
  nineteen
);
const untimed = input({}, { pause: { channels: ['takeaway'] } });
add('slotsForDate: untimed pause', 'slotsForDate', untimed, 'takeaway', '2026-10-21', nineteen);
add(
  'slotsForDate: untimed pause, other channel',
  'slotsForDate',
  untimed,
  'dineIn',
  '2026-10-21',
  nineteen
);
add(
  'slotsForDate: own hours clamp',
  'slotsForDate',
  input({ more: { takeaway: everyDay('12:00', '23:00') } }),
  'takeaway',
  '2026-10-22',
  noon
);
add(
  'slotsForDate: DST fall-back overnight',
  'slotsForDate',
  input(sat22to05, { defaultPrepMinutes: 0 }),
  'takeaway',
  '2026-10-24',
  t('2026-10-24T12:00:00+02:00')
);

for (const days of [-1, 0, 2.7, 7, 30, Number.NaN]) {
  add(`effectivePreorderDays ${days}`, 'effectivePreorderDays', days);
}

// Edges the unit tests leave to the code.
add('parsePeriods: no periods', 'parsePeriods', undefined, undefined, TZ, noon, noon + 86_400_000);
add(
  'parsePeriods: unknown close day',
  'parsePeriods',
  [{ openDay: 'WEDNESDAY', openTime: '11:00', closeDay: 'HOLIDAY', closeTime: '22:00' }],
  undefined,
  TZ,
  noon,
  noon + 86_400_000
);
add(
  'parsePeriods: hour without minutes',
  'parsePeriods',
  [{ openDay: 'WEDNESDAY', openTime: '11', closeDay: 'WEDNESDAY', closeTime: '22' }],
  undefined,
  TZ,
  noon,
  noon + 86_400_000
);
add(
  'parsePeriods: 24 hours into the next day',
  'parsePeriods',
  [{ openDay: 'WEDNESDAY', openTime: '11:00', closeDay: 'THURSDAY', closeTime: '11:00' }],
  undefined,
  TZ,
  noon - 86_400_000,
  noon + 2 * 86_400_000
);
add(
  'parsePeriods: same-day close equal to open',
  'parsePeriods',
  [{ openDay: 'WEDNESDAY', openTime: '11:00', closeDay: 'WEDNESDAY', closeTime: '11:00' }],
  [{ date: '2026-10-28', closed: false, openTime: '09:00', closeTime: '09:00' }],
  TZ,
  noon - 86_400_000,
  noon + 9 * 86_400_000
);
add(
  'parsePeriods: special day closed and changed',
  'parsePeriods',
  everyDay('11:00', '22:00'),
  [
    { date: '2026-10-21', closed: true },
    { date: '2026-10-22', closed: false, openTime: '14:00', closeTime: '01:00' },
  ],
  TZ,
  noon - 86_400_000,
  noon + 3 * 86_400_000
);
add(
  'parsePeriods: range outside every window',
  'parsePeriods',
  everyDay('11:00', '12:00'),
  undefined,
  TZ,
  t('2026-10-21T13:00:00+02:00'),
  t('2026-10-21T14:00:00+02:00')
);
add(
  'parsePeriods: opening in the spring gap',
  'parsePeriods',
  [],
  [{ date: '2027-03-28', closed: false, openTime: '02:30', closeTime: '04:00' }],
  TZ,
  t('2027-03-27T12:00:00+01:00'),
  t('2027-03-29T12:00:00+02:00')
);
add(
  'parsePeriods: opening in the fall overlap',
  'parsePeriods',
  [],
  [{ date: '2026-10-25', closed: false, openTime: '02:30', closeTime: '04:00' }],
  TZ,
  t('2026-10-24T12:00:00+02:00'),
  t('2026-10-26T12:00:00+01:00')
);
add(
  'parsePeriods: another time zone',
  'parsePeriods',
  everyDay('11:00', '22:00'),
  undefined,
  'America/New_York',
  t('2026-11-01T00:00:00-04:00'),
  t('2026-11-03T00:00:00-05:00')
);
add(
  'slots: slotMinutes 0 steps 15',
  'slots',
  input({}, { slotMinutes: 0 }),
  'takeaway',
  fifteen,
  1
);
add(
  'slots: slotMinutes 20',
  'slots',
  input({}, { slotMinutes: 20, cutoffMinutes: 0 }),
  'dineIn',
  fifteen,
  1
);
add('slots: negative preorder', 'slots', input({}, { preorderDays: -3 }), 'takeaway', eight, 5);
add(
  'slotsForDate: slotMinutes 0',
  'slotsForDate',
  input({}, { slotMinutes: 0 }),
  'delivery',
  '2026-10-22',
  fifteen
);
add(
  'slotsForDate: own hours on a closed special day',
  'slotsForDate',
  input({
    special: [{ date: '2026-10-22', closed: true }],
    more: { delivery: everyDay('12:00', '20:00') },
  }),
  'delivery',
  '2026-10-22',
  fifteen
);
add(
  'slotsForDate: channel off',
  'slotsForDate',
  input({}, offChannels),
  'takeaway',
  '2026-10-22',
  fifteen
);
add(
  'channelState: pause ended',
  'channelState',
  input({}, { pause: { channels: ['takeaway'], until: fifteen - 1 } }),
  'takeaway',
  fifteen
);
add(
  'channelState: pause runs past the lookahead',
  'channelState',
  input({}, { pause: { channels: ['takeaway'], until: fifteen + 30 * 86_400_000 } }),
  'takeaway',
  fifteen
);
add('channelState: closed all week', 'channelState', input({ regular: [] }), 'takeaway', fifteen);
add(
  'channelState: no delivery venue, closed',
  'channelState',
  input({}, { hasDeliveryVenue: false }),
  'delivery',
  t('2026-10-21T08:00:00+02:00')
);
add(
  'channelState: delivery own hours on a closed special day',
  'channelState',
  input({
    special: [{ date: '2026-10-22', closed: true }],
    more: { delivery: everyDay('12:00', '20:00') },
  }),
  'delivery',
  t('2026-10-21T21:00:00+02:00')
);
add(
  'channelState: overnight window open on a closed special day',
  'channelState',
  input({ regular: everyDay('18:00', '02:00'), special: [{ date: '2026-10-22', closed: true }] }),
  'takeaway',
  t('2026-10-22T01:00:00+02:00')
);
add(
  'serviceDayEnd: closed special day',
  'serviceDayEnd',
  {
    hours: { regular: everyDay('11:00', '22:00'), special: [{ date: '2026-10-21', closed: true }] },
    timeZone: TZ,
  },
  noon
);
add(
  'serviceDayEnd: split shifts',
  'serviceDayEnd',
  {
    hours: { regular: [...everyDay('11:00', '14:00'), ...everyDay('14:00', '22:00')] },
    timeZone: TZ,
  },
  noon
);

for (const [ms, timeZone] of /** @type {[number, string][]} */ ([
  [t('2026-10-21T23:30:00+02:00'), TZ],
  [t('2026-10-21T21:59:59Z'), TZ],
  [t('2026-10-21T22:00:00Z'), TZ],
  [t('2026-10-25T00:30:00Z'), TZ],
  [t('2026-10-25T01:30:00Z'), TZ],
  [t('2027-03-28T00:59:59Z'), TZ],
  [t('2027-03-28T01:00:00Z'), TZ],
  [t('2026-10-21T03:00:00Z'), 'America/New_York'],
  [t('2026-10-21T11:00:00Z'), 'Pacific/Kiritimati'],
  [t('2026-10-21T12:00:00Z'), 'UTC'],
])) {
  add(`localIsoDate ${new Date(ms).toISOString()} ${timeZone}`, 'localIsoDate', ms, timeZone);
}
for (const [date, days] of /** @type {[string, number][]} */ ([
  ['2026-10-21', 0],
  ['2026-10-21', 1],
  ['2026-10-31', 1],
  ['2026-12-31', 1],
  ['2028-02-28', 1],
  ['2027-02-28', 1],
  ['2026-03-01', -1],
  ['2026-10-25', 7],
])) {
  add(`addIsoDays ${date} ${days}`, 'addIsoDays', date, days);
}

// Sweeps over the DST weekends (2026-03-29, 2026-10-25, 2027-03-28): every
// channel of a few kinds of restaurant, every four hours from 00:30.
const HOUR = 3_600_000;
const restaurants = {
  'regular 11–22': input(),
  'lunch and dinner, own delivery and takeaway': input({
    regular: [...everyDay('11:00', '14:30'), ...everyDay('17:00', '23:00')],
    special: [
      { date: '2026-10-24', closed: true },
      { date: '2026-03-29', closed: false, openTime: '13:00', closeTime: '02:00' },
    ],
    more: { delivery: everyDay('17:30', '22:00'), takeaway: everyDay('11:30', '14:00') },
  }),
  'weekend nights': input(
    {
      regular: [
        { openDay: 'FRIDAY', openTime: '20:00', closeDay: 'SATURDAY', closeTime: '03:00' },
        { openDay: 'SATURDAY', openTime: '20:00', closeDay: 'SUNDAY', closeTime: '04:00' },
      ],
    },
    {
      cutoffMinutes: 45,
      slotMinutes: 30,
      busy: { extraMinutes: 20, until: t('2026-10-25T02:00:00+02:00') },
    }
  ),
  '24/7, delivery paused for a while': input(
    { regular: ALWAYS },
    {
      pause: { channels: ['delivery'], until: t('2026-10-25T01:30:00+01:00') },
      preorderDays: 1,
      slotMinutes: 60,
    }
  ),
  'regular 11–22, no delivery venue': input({}, { hasDeliveryVenue: false, cutoffMinutes: 0 }),
};
const weekends = [
  t('2026-03-28T00:30:00+01:00'),
  t('2026-10-24T00:30:00+02:00'),
  t('2027-03-27T00:30:00+01:00'),
];
const CHANNELS = ['dineIn', 'takeaway', 'delivery'];
for (const [label, engineInput] of Object.entries(restaurants)) {
  for (const start of weekends) {
    for (let at = start; at < start + 72 * HOUR; at += 4 * HOUR) {
      for (const channel of CHANNELS) {
        add(`sweep ${label}: ${channel}`, 'channelState', engineInput, channel, at);
      }
      add(`sweep ${label}`, 'serviceDayEnd', engineInput, at);
    }
    // Dine-in runs on the kitchen's hours, as takeaway without its own does.
    for (const channel of ['takeaway', 'delivery']) {
      add(`sweep ${label}: ${channel}`, 'slots', engineInput, channel, start + 9 * HOUR, 2);
      for (const offset of [0, 1]) {
        const date = new Date(start + 12 * HOUR + offset * 24 * HOUR).toISOString().slice(0, 10);
        add(
          `sweep ${label}: ${channel}`,
          'slotsForDate',
          engineInput,
          channel,
          date,
          start + 8 * HOUR
        );
      }
    }
  }
}

// --- Run the engine ------------------------------------------------------------

/** JSON cannot hold NaN or ±Infinity: write them as `{ "$number": "…" }`. */
function encode(/** @type {unknown} */ value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v
    )
  );
}

const dir = mkdtempSync(join(tmpdir(), 'ordering-hours-'));
/** @type {Record<string, (...args: unknown[]) => unknown>} */
let engine;
try {
  const source = readFileSync(resolve(values.engine), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  writeFileSync(join(dir, 'hours.mjs'), code);
  engine = await import(pathToFileURL(join(dir, 'hours.mjs')).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Inputs repeat across cases, so each distinct object argument is written once
// under `inputs` and a case refers to it as `{ "$input": <index> }`.
/** @type {unknown[]} */
const inputs = [];
/** @type {Map<string, number>} */
const inputIndex = new Map();
function shared(/** @type {unknown} */ arg) {
  if (typeof arg !== 'object' || arg === null) return encode(arg);
  const key = JSON.stringify(encode(arg));
  let index = inputIndex.get(key);
  if (index === undefined) {
    index = inputs.push(encode(arg)) - 1;
    inputIndex.set(key, index);
  }
  return { $input: index };
}

const fixture = {
  note: "Inputs to the hours engine and the Medal API's own engine's answers. Generated: node scripts/export-hours-fixtures.mjs --engine <monorepo>/apps/shared/ordering/hours.ts",
  defaultTimeZone: engine.DEFAULT_TIME_ZONE,
  inputs: /** @type {unknown[]} */ ([]),
  cases: cases.map(({ name, fn, args }) => ({
    name,
    fn,
    // `undefined` has no JSON form; a case that passes it says so with `null`.
    args: args.map((arg) => (arg === undefined ? null : shared(arg))),
    result: encode(engine[fn](...args)),
  })),
};
fixture.inputs = inputs;

// Biome lays the file out (`pnpm lint` checks it), so a refresh diffs cleanly.
// A window stays on one line (Biome keeps an object flat when it starts flat).
const json = JSON.stringify(fixture, null, 2).replace(
  /\{\n\s+"start": (\d+),\n\s+"end": (\d+)\n\s+\}/g,
  '{ "start": $1, "end": $2 }'
);
writeFileSync(out, `${json}\n`);
const biome = spawnSync('pnpm', ['exec', 'biome', 'format', '--write', out], {
  cwd: root,
  stdio: 'inherit',
});
if (biome.status !== 0) {
  console.error('[export-hours-fixtures] biome format failed');
  process.exit(1);
}
console.log(`[export-hours-fixtures] ${fixture.cases.length} cases → ${out}`);

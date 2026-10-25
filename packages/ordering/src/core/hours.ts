/**
 * Restaurant ordering hours engine: kitchen and channel windows, channel
 * state, and pickup/delivery slots. Pure TypeScript (runs on the server and in
 * the browser); epoch ms everywhere, wall-clock reasoning in an IANA time zone.
 *
 * This is the Medal API's own engine, ported with its logic unchanged and its
 * names kept so the two diff cleanly. Change it only together with the API's;
 * tests/core/hours.parity.test.ts holds it to the API engine's answers
 * (tests/fixtures/hours.json, written by scripts/export-hours-fixtures.mjs).
 */

export const DEFAULT_TIME_ZONE = 'Europe/Oslo';

export type Channel = 'dineIn' | 'takeaway' | 'delivery';
export type ChannelReason = 'closed' | 'cutoff' | 'paused' | 'kitchen_closed' | 'delivery_off';

export interface HoursPeriod {
  openDay: string;
  openTime: string;
  closeDay: string;
  closeTime: string;
}

export interface SpecialDay {
  date: string;
  closed: boolean;
  openTime?: string;
  closeTime?: string;
}

export interface LocationHours {
  regular: HoursPeriod[];
  special?: SpecialDay[];
  more?: { delivery?: HoursPeriod[]; takeaway?: HoursPeriod[] };
}

export interface OrderingSettings {
  channels: { dineIn: boolean; takeaway: boolean; delivery: boolean };
  cutoffMinutes: number;
  defaultPrepMinutes: number;
  preorderDays: number;
  slotMinutes: number;
  busy?: { extraMinutes: number; until?: number };
  pause?: { channels: Channel[]; until?: number; reason?: string };
  hasDeliveryVenue: boolean;
}

export interface EngineInput {
  hours: LocationHours;
  settings: OrderingSettings;
  timeZone: string;
}

export interface ChannelState {
  open: boolean;
  reason?: ChannelReason;
  opensAt?: number;
  closesAt?: number;
  lastOrderAt?: number;
}

/** Half-open interval [start, end) in epoch ms. */
export interface Window {
  start: number;
  end: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const LOOKAHEAD_DAYS = 8;
const DAYS_OF_WEEK = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// --- Time zone helpers -------------------------------------------------------

/** A local calendar date, encoded as UTC midnight of that date (date math only). */
type LocalDate = number;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The instant's local wall clock, encoded as if it were UTC. */
function localWallMs(ms: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  );
}

function offsetAt(ms: number, timeZone: string): number {
  const floored = Math.floor(ms / 1000) * 1000;
  return localWallMs(floored, timeZone) - floored;
}

function localDateOf(ms: number, timeZone: string): LocalDate {
  const wall = localWallMs(ms, timeZone);
  return wall - (((wall % DAY) + DAY) % DAY);
}

/**
 * Local wall time to an instant. Nonexistent times (spring gap) move forward by
 * the gap; ambiguous times (fall overlap) take the earlier instant.
 */
function wallToUtc(wall: number, timeZone: string): number {
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const valid = [wall - before, wall - after].filter((ms) => localWallMs(ms, timeZone) === wall);
  if (valid.length > 0) return Math.min(...valid);
  return wall - before;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isoDate(date: LocalDate): string {
  return new Date(date).toISOString().slice(0, 10);
}

function weekdayOf(date: LocalDate): string {
  return DAYS_OF_WEEK[new Date(date).getUTCDay()];
}

/** One window opening on `date` at `open`, closing `dayOffset` days later at `close` (overnight if needed). */
function windowOn(
  date: LocalDate,
  open: string,
  close: string,
  dayOffset: number,
  timeZone: string
): Window {
  const openMin = minutesOf(open);
  const closeMin = minutesOf(close);
  const offset = dayOffset === 0 && closeMin <= openMin ? 1 : dayOffset;
  return {
    start: wallToUtc(date + openMin * MINUTE, timeZone),
    end: wallToUtc(date + offset * DAY + closeMin * MINUTE, timeZone),
  };
}

/** The instant's local calendar date in `timeZone`, as `YYYY-MM-DD`. */
export function localIsoDate(ms: number, timeZone: string): string {
  return isoDate(localDateOf(ms, timeZone));
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addIsoDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY);
}

// --- Windows -----------------------------------------------------------------

/** A window plus the local date it opens on (the service day it belongs to). */
interface DatedWindow extends Window {
  date: LocalDate;
}

// Periods may span several days (FRI 18:00 → SUN 02:00), so look back a week.
const LOOKBACK_DAYS = 7;

function mergeWindows(windows: Window[]): Window[] {
  const sorted = windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ start: w.start, end: w.end });
  }
  return merged;
}

function intersect(a: Window[], b: Window[]): Window[] {
  const out: Window[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeWindows(out);
}

/** Unmerged windows per opening date, for dates from a week before `fromMs` through `toMs`'s date. */
function datedWindows(
  periods: HoursPeriod[] | undefined,
  specials: SpecialDay[] | undefined,
  timeZone: string,
  fromMs: number,
  toMs: number
): DatedWindow[] {
  const windows: DatedWindow[] = [];
  const last = localDateOf(toMs, timeZone);
  for (let date = localDateOf(fromMs, timeZone) - LOOKBACK_DAYS * DAY; date <= last; date += DAY) {
    const special = specials?.find((s) => s.date === isoDate(date));
    if (special?.closed) continue;
    if (special?.openTime && special.closeTime) {
      windows.push({ date, ...windowOn(date, special.openTime, special.closeTime, 0, timeZone) });
      continue;
    }
    const weekday = weekdayOf(date);
    for (const p of periods ?? []) {
      if (p.openDay !== weekday) continue;
      const openIdx = DAYS_OF_WEEK.indexOf(p.openDay);
      const closeIdx = DAYS_OF_WEEK.indexOf(p.closeDay);
      const dayOffset = closeIdx < 0 ? 0 : (closeIdx - openIdx + 7) % 7;
      windows.push({ date, ...windowOn(date, p.openTime, p.closeTime, dayOffset, timeZone) });
    }
  }
  return windows.filter((w) => w.end > w.start);
}

/**
 * Stored weekly periods plus special days to absolute windows overlapping
 * [fromMs, toMs), sorted and merged. A special day replaces the periods that
 * open on its date (closed → none; hours → one window). Windows are not
 * clipped to the range, so their real open/close instants survive.
 */
export function parsePeriods(
  periods: HoursPeriod[] | undefined,
  specials: SpecialDay[] | undefined,
  timeZone: string,
  fromMs: number,
  toMs: number
): Window[] {
  return mergeWindows(datedWindows(periods, specials, timeZone, fromMs, toMs)).filter(
    (w) => w.end > fromMs && w.start < toMs
  );
}

function kitchenWindows(
  input: Pick<EngineInput, 'hours' | 'timeZone'>,
  from: number,
  to: number
): Window[] {
  return parsePeriods(input.hours.regular, input.hours.special, input.timeZone, from, to);
}

function ownPeriods(input: EngineInput, channel: Channel): HoursPeriod[] | undefined {
  return channel === 'dineIn' ? undefined : input.hours.more?.[channel];
}

const closedSpecials = (input: EngineInput) => input.hours.special?.filter((s) => s.closed);

function channelWindows(
  input: EngineInput,
  channel: Channel,
  from: number,
  to: number,
  kitchen: Window[]
): Window[] {
  const own = ownPeriods(input, channel);
  if (!own) return kitchen;
  // Closed special days close the channel; special hours clamp it via the kitchen.
  return intersect(parsePeriods(own, closedSpecials(input), input.timeZone, from, to), kitchen);
}

const inside = (windows: Window[], at: number) => windows.find((w) => w.start <= at && at < w.end);

// --- Channel state -----------------------------------------------------------

function pauseApplies(settings: OrderingSettings, channel: Channel): boolean {
  return settings.pause?.channels.includes(channel) ?? false;
}

function pauseActive(settings: OrderingSettings, channel: Channel, at: number): boolean {
  const until = settings.pause?.until;
  return pauseApplies(settings, channel) && (until === undefined || until > at);
}

export function prepMinutes(
  settings: Pick<OrderingSettings, 'defaultPrepMinutes' | 'busy'>,
  at: number
): number {
  const busy = settings.busy;
  const active = busy && (busy.until === undefined || busy.until > at);
  return settings.defaultPrepMinutes + (active ? busy.extraMinutes : 0);
}

/** Earliest instant >= at when the channel takes orders, within the lookahead. */
function nextOpening(
  input: EngineInput,
  channel: Channel,
  windows: Window[],
  at: number
): number | undefined {
  const { settings } = input;
  if (channel === 'delivery' && !settings.hasDeliveryVenue) return undefined;
  let earliest = at;
  if (pauseActive(settings, channel, at)) {
    if (settings.pause?.until === undefined) return undefined;
    earliest = settings.pause.until;
  }
  const cutoff = settings.cutoffMinutes * MINUTE;
  for (const w of windows) {
    const start = Math.max(w.start, earliest);
    if (start < w.end - cutoff) return start;
  }
  return undefined;
}

export function channelState(input: EngineInput, channel: Channel, at: number): ChannelState {
  const { settings, hours, timeZone } = input;
  if (!settings.channels[channel]) {
    return { open: false, reason: channel === 'delivery' ? 'delivery_off' : 'closed' };
  }

  const from = at - DAY;
  const to = at + (LOOKAHEAD_DAYS + 1) * DAY;
  const kitchen = kitchenWindows(input, from, to);
  const windows = channelWindows(input, channel, from, to, kitchen).filter((w) => w.end > at);
  const closed = (reason: ChannelReason, extra: Partial<ChannelState> = {}): ChannelState => {
    const opensAt = nextOpening(input, channel, windows, at);
    return {
      open: false,
      reason,
      ...extra,
      ...(opensAt !== undefined && opensAt < at + LOOKAHEAD_DAYS * DAY ? { opensAt } : {}),
    };
  };

  const inKitchen = inside(kitchen, at);
  const special = hours.special?.find((s) => s.date === isoDate(localDateOf(at, timeZone)));
  if (special?.closed && !inKitchen) return closed('closed');
  if (!inKitchen) return closed('kitchen_closed');
  const current = inside(windows, at);
  if (!current) return closed('closed');
  if (pauseActive(settings, channel, at)) return closed('paused');

  // A window running past the computed range (e.g. 24/7) has no known close.
  const bounded = current.end < to;
  const closesAt = current.end;
  const lastOrderAt = closesAt - settings.cutoffMinutes * MINUTE;
  if (bounded && at >= lastOrderAt) return closed('cutoff', { closesAt, lastOrderAt });
  if (channel === 'delivery' && !settings.hasDeliveryVenue) {
    return { open: false, reason: 'delivery_off' };
  }
  return bounded ? { open: true, closesAt, lastOrderAt } : { open: true };
}

// --- Slots -------------------------------------------------------------------

const MAX_PREORDER_DAYS = 7;

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Days ahead a slot can be booked: whole days, 0 (today only) to 7. */
export function effectivePreorderDays(preorderDays: number): number {
  return clampInt(preorderDays, 0, MAX_PREORDER_DAYS);
}

/** Slot starts in each window from `earliest` to the window end minus cutoff (and `cap`). */
function stepSlots(
  windows: Window[],
  settings: OrderingSettings,
  timeZone: string,
  earliest: number,
  cap = Number.POSITIVE_INFINITY
): Window[] {
  const step = (settings.slotMinutes > 0 ? settings.slotMinutes : 15) * MINUTE;
  const cutoff = settings.cutoffMinutes * MINUTE;
  const out: Window[] = [];
  for (const w of windows) {
    // Same rule as channelState: the last order is strictly before close − cutoff.
    const lastOrderAt = w.end - cutoff;
    let s = Math.max(w.start, earliest);
    while (s < lastOrderAt && s <= cap) {
      // Realign at each candidate so offset changes (incl. 30-min DST) stay on local boundaries.
      const misalign = (((s + offsetAt(s, timeZone)) % step) + step) % step;
      if (misalign !== 0) {
        s += step - misalign;
        continue;
      }
      out.push({ start: s, end: s + step });
      s += step;
    }
  }
  return out;
}

/** First slot instant: now plus prep, and not before a timed pause ends. */
function earliestSlot(settings: OrderingSettings, channel: Channel, now: number): number {
  let earliest = now + prepMinutes(settings, now) * MINUTE;
  if (pauseActive(settings, channel, now) && settings.pause?.until !== undefined) {
    earliest = Math.max(earliest, settings.pause.until);
  }
  return earliest;
}

/** No slots at all: channel off, delivery without a venue, or paused until turned off. */
function takesNoSlots(settings: OrderingSettings, channel: Channel): boolean {
  if (!settings.channels[channel]) return true;
  if (channel === 'delivery' && !settings.hasDeliveryVenue) return true;
  return pauseApplies(settings, channel) && settings.pause?.until === undefined;
}

/**
 * Pickup/delivery slots from `from` in windows opening on the first
 * min(days, preorderDays + 1) local dates (windows already open at `from`
 * count too). Starts sit on local slot boundaries and step in absolute time,
 * so a DST change neither invents nor repeats a start.
 */
export function slots(input: EngineInput, channel: Channel, from: number, days: number): Window[] {
  const { settings, timeZone } = input;
  if (takesNoSlots(settings, channel)) return [];

  const preorderDays = effectivePreorderDays(settings.preorderDays);
  const dayCount = clampInt(days, 1, preorderDays + 1);
  const firstDate = localDateOf(from, timeZone);
  const lastDate = firstDate + (dayCount - 1) * DAY;

  // The range ends where the last allowed date's windows close (overnight included).
  let rangeEnd = wallToUtc(lastDate + DAY, timeZone);
  const searchTo = rangeEnd + DAY;
  const kitchenDated = datedWindows(
    input.hours.regular,
    input.hours.special,
    timeZone,
    from,
    searchTo
  );
  const own = ownPeriods(input, channel);
  const ownDated = own ? datedWindows(own, closedSpecials(input), timeZone, from, searchTo) : [];
  for (const w of [...kitchenDated, ...ownDated]) {
    if (w.date === lastDate) rangeEnd = Math.max(rangeEnd, w.end);
  }

  const kitchen = kitchenWindows(input, from, searchTo);
  const windows = channelWindows(input, channel, from, searchTo, kitchen);
  return stepSlots(
    windows,
    settings,
    timeZone,
    earliestSlot(settings, channel, from),
    rangeEnd - 1
  );
}

/**
 * Channel windows per opening date (the service date): own hours clamped to
 * the kitchen, else the kitchen; merged within a date, never across dates.
 */
function channelDatedWindows(
  input: EngineInput,
  channel: Channel,
  from: number,
  to: number
): DatedWindow[] {
  const { hours, timeZone } = input;
  const kitchenDated = datedWindows(hours.regular, hours.special, timeZone, from, to);
  const own = ownPeriods(input, channel);
  let dated = kitchenDated;
  if (own) {
    const kitchen = mergeWindows(kitchenDated);
    dated = datedWindows(own, closedSpecials(input), timeZone, from, to).flatMap((w) =>
      intersect([w], kitchen).map((x) => ({ ...x, date: w.date }))
    );
  }
  const byDate = new Map<LocalDate, Window[]>();
  for (const w of dated) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  return [...byDate.entries()]
    .flatMap(([date, list]) => mergeWindows(list).map((w) => ({ ...w, date })))
    .sort((a, b) => a.start - b.start);
}

/**
 * Slots of one service date (`YYYY-MM-DD`, local): only channel windows that
 * open on that date, so an overnight window's after-midnight slots belong to
 * the evening it opened. For today, a window that opened earlier and is still
 * open at `now` counts too. Starts are at least now plus prep (and after a
 * timed pause), at most window end minus cutoff, on local slot boundaries.
 * A date before today or past today + effectivePreorderDays gives none.
 */
export function slotsForDate(
  input: EngineInput,
  channel: Channel,
  date: string,
  now: number
): Window[] {
  const { settings, timeZone } = input;
  if (takesNoSlots(settings, channel)) return [];
  const today = localIsoDate(now, timeZone);
  const last = addIsoDays(today, effectivePreorderDays(settings.preorderDays));
  if (date < today || date > last) return [];

  const target: LocalDate = Date.parse(`${date}T00:00:00Z`);
  const dayStart = wallToUtc(target, timeZone);
  const windows = channelDatedWindows(
    input,
    channel,
    Math.min(now, dayStart),
    dayStart + 2 * DAY
  ).filter((w) => w.date === target || (date === today && w.start <= now && now < w.end));

  const seen = new Set<number>();
  return stepSlots(windows, settings, timeZone, earliestSlot(settings, channel, now))
    .filter((slot) => !seen.has(slot.start) && seen.add(slot.start))
    .sort((a, b) => a.start - b.start);
}

// --- Service day -------------------------------------------------------------

/**
 * End of the service day containing `at`: the end of the first kitchen window
 * that contains `at` or opens on its local date, else the next local midnight.
 * Uses per-date windows so continuous hours don't merge into one long day.
 */
export function serviceDayEnd(input: Pick<EngineInput, 'hours' | 'timeZone'>, at: number): number {
  const { timeZone } = input;
  const today = localDateOf(at, timeZone);
  const dated = datedWindows(input.hours.regular, input.hours.special, timeZone, at, at + DAY);
  // Merge only windows sharing an opening date.
  const byDate = new Map<LocalDate, Window[]>();
  for (const w of dated) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const windows = [...byDate.entries()]
    .flatMap(([date, list]) => mergeWindows(list).map((w) => ({ ...w, date })))
    .sort((a, b) => a.start - b.start);
  const match = windows.find((w) => w.end > at && (w.start <= at || w.date === today));
  return match ? match.end : wallToUtc(today + DAY, timeZone);
}

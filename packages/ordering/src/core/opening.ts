/**
 * When a closed restaurant opens again, in the guest's words: «kl. 11:00»
 * today, «i morgen kl. 11:00», a weekday within the week, a date after that.
 * Days and times are the restaurant's (`timeZone`), not the viewer's: a guest
 * abroad still reads the opening as the restaurant states it.
 */
import { labelLocale } from './labels';
import { fill, type OrderingLabels } from './ui-labels';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The wall-clock day (as UTC midnight ms) and `HH:mm` of an instant in a time zone. */
export function wallClock(at: Date, timeZone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    (parts.find((p) => p.type === type) as Intl.DateTimeFormatPart).value;
  const day = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')));
  return { day, time: `${part('hour')}:${part('minute')}` };
}

/**
 * «Åpner kl. 11:00» and the like, or `null` when there is no opening to tell:
 * none given, unreadable, or not after `now`.
 */
export function openingLine(
  nextOpenAt: Date | string | number | null | undefined,
  now: Date,
  timeZone: string,
  locale: string,
  labels: OrderingLabels
): string | null {
  if (nextOpenAt === undefined || nextOpenAt === null) return null;
  const at = new Date(nextOpenAt);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
  const next = wallClock(at, timeZone);
  const days = Math.round((next.day - wallClock(now, timeZone).day) / DAY_MS);
  const time = next.time;
  if (days === 0) return fill(labels.opensToday, { time });
  if (days === 1) return fill(labels.opensTomorrow, { time });
  if (days < 7) {
    const day = labels.weekdays[new Date(next.day).getUTCDay()] as string;
    return fill(labels.opensOn, { day, time });
  }
  const date = new Intl.DateTimeFormat(labelLocale(locale) === 'nb' ? 'nb-NO' : 'en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).format(at);
  return fill(labels.opensOnDate, { date, time });
}

/**
 * «The restaurant is not taking orders right now», and when it opens again:
 * «kl. 11:00» today, «i morgen kl. 11:00», a weekday within the week, a date
 * after that. Days and times are the restaurant's (`timeZone`), not the
 * viewer's: a guest abroad still reads the opening as the restaurant states it.
 */
import { useSyncExternalStore } from 'react';
import { labelLocale } from '../core/labels';
import { cx } from './cx';
import { fill, mergeLabels, type OrderingLabels } from './labels';

export interface ClosedNoticeProps {
  /** The next opening, or nothing to say only that it is closed. A past or unreadable one is ignored. */
  nextOpenAt?: Date | string | number | null;
  /** The restaurant's IANA time zone. Default `Europe/Oslo`. */
  timeZone?: string;
  /** BCP 47. Default `nb`. */
  locale?: string;
  labels?: Partial<OrderingLabels>;
  /**
   * The clock, for tests. Default the browser's current time — read only
   * after hydration, so the server renders the first sentence alone.
   */
  now?: Date;
  id?: string;
  className?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** «Is there a client clock?» only ever flips once; `useSyncExternalStore` wants a subscription. */
function noopSubscribe(): () => void {
  return () => {
    // Nothing to unsubscribe from.
  };
}

/** The wall-clock date and time of an instant in a time zone. */
function wallClock(at: Date, timeZone: string) {
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

function opening(
  nextOpenAt: ClosedNoticeProps['nextOpenAt'],
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

export function ClosedNotice({
  nextOpenAt,
  timeZone = 'Europe/Oslo',
  locale = 'nb',
  labels: overrides,
  now,
  id,
  className,
}: ClosedNoticeProps) {
  const labels = mergeLabels(locale, overrides);
  // Without `now`, the opening line waits for the browser's clock: a cached or
  // ISR server render is read at another time than it hydrates, and «i morgen»
  // can be «i dag» by then. Hydration renders the server's tree (no line), then
  // the client adds it. A snapshot of `Date.now()` itself would change on every
  // read, so the store answers «hydrated», and the clock is read after that.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  const clock = now ?? (hydrated ? new Date() : null);
  const opens = clock === null ? null : opening(nextOpenAt, clock, timeZone, locale, labels);
  return (
    <div
      role="status"
      id={id}
      className={cx('rounded-lg border border-border bg-muted p-4 text-foreground', className)}
    >
      <p className="font-medium">{labels.closed}</p>
      {opens === null ? null : <p className="text-muted-foreground">{opens}</p>}
    </div>
  );
}

/**
 * «The restaurant is not taking orders right now», and when it opens again:
 * «kl. 11:00» today, «i morgen kl. 11:00», a weekday within the week, a date
 * after that. Days and times are the restaurant's (`timeZone`), not the
 * viewer's: a guest abroad still reads the opening as the restaurant states it.
 */
import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { openingLine } from '../core/opening';
import { mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { cx } from './cx';

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

const MINUTE_MS = 60 * 1000;

/** «Is there a client clock?» only ever flips once; `useSyncExternalStore` wants a subscription. */
function noopSubscribe(): () => void {
  return () => {
    // Nothing to unsubscribe from.
  };
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
  const opens = clock === null ? null : openingLine(nextOpenAt, clock, timeZone, locale, labels);
  // On the browser's clock the line must move on by itself: «i morgen» turns
  // into «i dag» at midnight, and the line goes once it opens. Every
  // restaurant midnight falls on a whole minute (time-zone offsets are whole
  // minutes), so a render at each minute boundary — or at the opening, if
  // that comes first — is never stale. One timer at a time, cleared on every
  // render and on unmount.
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const live = now === undefined && opens !== null;
  useEffect(() => {
    if (!live) return;
    const at = Date.now();
    const opensAt = new Date(nextOpenAt as Date | string | number).getTime();
    const timer = setTimeout(tick, Math.min(MINUTE_MS - (at % MINUTE_MS), opensAt - at));
    return () => clearTimeout(timer);
  });
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

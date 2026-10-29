/**
 * The order's status for a receipt page: the order number, where it is now in
 * the guest's words, when it should be ready, and the steps it goes through.
 * It asks again every 15 s until there is nothing left to wait for (handed
 * over, completed, or ended without food), and at once when the guest comes
 * back to the tab.
 *
 * The page passes `load`, usually `fetchOrderStatus` against the site's
 * status route; a failed read keeps the last status on screen with a short
 * note and tries again on the next round. Changes are announced politely.
 */
import type { OrderingOrderStatusView } from '@medalsocial/sdk';
import { useEffect, useId, useRef, useState } from 'react';
import type { RouteResult } from '../core/client';
import { wallClock } from '../core/opening';
import {
  isFinalStatus,
  ORDER_STEPS,
  orderStatusLabel,
  orderStepIndex,
  STATUS_POLL_MS,
} from '../core/status';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { cx } from './cx';

export interface OrderStatusProps {
  orderId: string;
  /** Read the status (`(id, signal) => fetchOrderStatus(url, id, signal)`). */
  load: (orderId: string, signal: AbortSignal) => Promise<RouteResult<OrderingOrderStatusView>>;
  /** A status the page already has (a server render); reading starts after it. */
  initial?: OrderingOrderStatusView;
  /** The restaurant's IANA time zone. Default `Europe/Oslo`. */
  timeZone?: string;
  /** BCP 47. Default `nb`. */
  locale?: string;
  labels?: Partial<OrderingLabels>;
  /** Milliseconds between reads. Default `STATUS_POLL_MS`. */
  intervalMs?: number;
  className?: string;
}

const DECLINED: Readonly<Record<string, keyof OrderingLabels>> = {
  sold_out: 'declinedSoldOut',
  too_busy: 'declinedTooBusy',
  closing_soon: 'declinedClosingSoon',
  timeout: 'declinedTimeout',
};

/** The line under the status: the wait, the reason, the money. */
function detail(view: OrderingOrderStatusView, timeZone: string, labels: OrderingLabels): string[] {
  const lines: string[] = [];
  if (view.status === 'awaiting_payment') lines.push(labels.awaitingPayment);
  if (view.status === 'declined') {
    lines.push(labels[DECLINED[view.decline_reason ?? ''] ?? 'declinedOther'] as string);
  }
  if (view.ready_at && !isFinalStatus(view.status)) {
    lines.push(fill(labels.readyAt, { time: wallClock(new Date(view.ready_at), timeZone).time }));
  }
  if (view.payment.state === 'refunded') lines.push(labels.refunded);
  else if (
    (view.status === 'declined' || view.status === 'abandoned' || view.status === 'cancelled') &&
    view.payment.state !== 'captured'
  ) {
    lines.push(labels.notCharged);
  }
  return lines;
}

export function OrderStatus({
  orderId,
  load,
  initial,
  timeZone = 'Europe/Oslo',
  locale = 'nb',
  labels: overrides,
  intervalMs = STATUS_POLL_MS,
  className,
}: OrderStatusProps) {
  const labels = mergeLabels(locale, overrides);
  const id = useId();
  const [view, setView] = useState<OrderingOrderStatusView | undefined>(initial);
  const [failed, setFailed] = useState<'unavailable' | 'not_found' | null>(null);
  const final = view !== undefined && isFinalStatus(view.status);
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasInitial = initial !== undefined;

  useEffect(() => {
    if (final) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;

    async function read() {
      clearTimeout(timer);
      if (reading) return;
      reading = true;
      let result: RouteResult<OrderingOrderStatusView>;
      try {
        result = await loadRef.current(orderId, controller.signal);
      } catch {
        result = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'load threw' } };
      }
      reading = false;
      if (controller.signal.aborted) return;
      if (result.ok) {
        setView(result.data);
        setFailed(null);
        if (isFinalStatus(result.data.status)) return;
      } else {
        setFailed(result.error.code === 'ORDER_NOT_FOUND' ? 'not_found' : 'unavailable');
        if (result.error.code === 'ORDER_NOT_FOUND') return;
      }
      timer = setTimeout(read, intervalMs);
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void read();
    }

    if (!hasInitial) void read();
    else timer = setTimeout(read, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderId, final, intervalMs, hasInitial]);

  const reached = view === undefined ? -1 : orderStepIndex(view.status);
  const lines = view === undefined ? [] : detail(view, timeZone, labels);

  return (
    <section aria-labelledby={`${id}-title`} className={cx('flex flex-col gap-4', className)}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {view ? fill(labels.orderNumber, { number: view.order_number }) : labels.orderSteps}
      </h2>
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        {view ? (
          <p className="text-2xl font-semibold">{orderStatusLabel(view.status, locale)}</p>
        ) : null}
        {lines.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
        {failed ? (
          <p className="text-sm text-muted-foreground">
            {failed === 'not_found' ? labels.errorNotFound : labels.statusUnavailable}
          </p>
        ) : null}
      </div>
      {view && reached >= 0 ? (
        <ol aria-label={labels.orderSteps} className="flex flex-col gap-2">
          {ORDER_STEPS.map((step, index) => (
            <li
              key={step}
              aria-current={index === reached ? 'step' : undefined}
              className={cx(
                'flex items-center gap-3',
                index > reached ? 'text-muted-foreground' : 'font-medium'
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'size-3 rounded-full border border-border',
                  index <= reached ? 'bg-primary' : 'bg-background'
                )}
              />
              {orderStatusLabel(step, locale)}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

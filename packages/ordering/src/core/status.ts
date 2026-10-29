/**
 * An order's status in the guest's words, and where it stands on the way to
 * them: the Medal API's own status names and labels (nb, en, ar), the steps
 * a receipt shows, and whether there is anything left to wait for.
 */
import type { OrderingOrderStatus } from '@medalsocial/sdk';
import { type LabelLocale, labelLocale } from './labels';

export const ORDER_STATUS_LABELS: Readonly<
  Record<OrderingOrderStatus, Readonly<Record<LabelLocale, string>>>
> = {
  awaiting_payment: { nb: 'Venter på betaling', en: 'Awaiting payment', ar: 'في انتظار الدفع' },
  placed: { nb: 'Mottatt', en: 'Placed', ar: 'تم الاستلام' },
  accepted: { nb: 'Godkjent', en: 'Accepted', ar: 'تمت الموافقة' },
  preparing: { nb: 'Tilberedes', en: 'Preparing', ar: 'قيد التحضير' },
  ready: { nb: 'Klar', en: 'Ready', ar: 'جاهز' },
  handed_over: { nb: 'Utlevert', en: 'Handed over', ar: 'تم التسليم' },
  completed: { nb: 'Fullført', en: 'Completed', ar: 'مكتمل' },
  declined: { nb: 'Avvist', en: 'Declined', ar: 'مرفوض' },
  abandoned: { nb: 'Forlatt', en: 'Abandoned', ar: 'متروك' },
  cancelled: { nb: 'Kansellert', en: 'Cancelled', ar: 'ملغى' },
  refunded: { nb: 'Refundert', en: 'Refunded', ar: 'تم الاسترداد' },
};

/** The status in a BCP 47 locale's words (nb, en or ar; anything else English). */
export function orderStatusLabel(status: OrderingOrderStatus, locale = 'nb'): string {
  return ORDER_STATUS_LABELS[status][labelLocale(locale)];
}

/**
 * The steps of an order that goes well, in order — what a receipt draws as
 * its timeline. `awaiting_payment` comes before them for a Vipps order, and
 * `completed` closes them; neither is a step the guest waits on.
 */
export const ORDER_STEPS = ['placed', 'accepted', 'preparing', 'ready', 'handed_over'] as const;

const FINAL: ReadonlySet<OrderingOrderStatus> = new Set([
  'handed_over',
  'completed',
  'declined',
  'abandoned',
  'cancelled',
  'refunded',
]);

/**
 * Nothing left for the guest to wait for: the food is handed over (or the
 * order is completed), or it ended without being made. Polling stops here.
 * `handed_over` still moves on to `completed`, and `cancelled` to
 * `refunded`, but on the restaurant's side only.
 */
export function isFinalStatus(status: OrderingOrderStatus): boolean {
  return FINAL.has(status);
}

/** The order ended without the guest getting food. */
export function isUnsuccessfulStatus(status: OrderingOrderStatus): boolean {
  return (
    status === 'declined' ||
    status === 'abandoned' ||
    status === 'cancelled' ||
    status === 'refunded'
  );
}

/**
 * How far along the steps an order is: the index in `ORDER_STEPS` of the
 * step it has reached, `ORDER_STEPS.length` once completed, and `-1` before
 * the first (awaiting payment) or when it ended unsuccessfully.
 */
export function orderStepIndex(status: OrderingOrderStatus): number {
  if (status === 'completed') return ORDER_STEPS.length;
  return (ORDER_STEPS as readonly string[]).indexOf(status);
}

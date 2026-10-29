/**
 * An error from the site's ordering routes in the guest's words. The API's
 * own `message` is English for logs; this is what a guest reads.
 */
import type { OrderingRouteError, OrderingRouteErrorCode } from './checkout';
import { fill, type OrderingLabels } from './ui-labels';

const MESSAGE: Readonly<Record<OrderingRouteErrorCode, keyof OrderingLabels>> = {
  CLOSED: 'errorClosed',
  CUTOFF: 'errorCutoff',
  CHANNEL_NOT_AVAILABLE: 'errorChannel',
  PREORDER_DISABLED: 'errorPreorder',
  SLOT_TAKEN: 'errorSlotTaken',
  TABLE_NOT_FOUND: 'errorTable',
  SOLD_OUT: 'errorSoldOut',
  UNAVAILABLE: 'errorUnavailable',
  INVALID_OPTIONS: 'errorOptions',
  INVALID_CART: 'errorCart',
  PAYMENT_METHOD_NOT_ALLOWED: 'errorPaymentMethod',
  PAYMENT_UNAVAILABLE: 'errorVipps',
  RETURN_URL_NOT_ALLOWED: 'errorVipps',
  INVALID_CUSTOMER: 'errorCustomer',
  QUOTE_NOT_USABLE: 'errorQuote',
  QUOTE_EXPIRED: 'errorQuote',
  SAVED_ADDRESS_NOT_FOUND: 'errorSavedAddress',
  RATE_LIMITED: 'errorRateLimited',
  IDEMPOTENCY_IN_PROGRESS: 'errorInProgress',
  IDEMPOTENCY_CONFLICT: 'errorConflict',
  ORDERING_NOT_ENABLED: 'errorNotEnabled',
  NOT_CONFIGURED: 'errorNotEnabled',
  ORDER_NOT_FOUND: 'errorNotFound',
  INVALID_REQUEST: 'errorGeneric',
  SERVICE_UNAVAILABLE: 'errorGeneric',
};

const CUSTOMER_FIELD: Readonly<Record<string, keyof OrderingLabels>> = {
  name: 'nameError',
  phone: 'phoneError',
  email: 'emailError',
  allergy_note: 'allergyNoteError',
};

/**
 * The guest's message for an error. `CLOSED` gains `opens` after it («Åpner
 * kl. 11:00», from `openingLine`) when the page knows the next opening;
 * `INVALID_CUSTOMER` names the field when the error says which. A code this
 * version does not know reads as the generic «try again».
 */
export function refusalMessage(
  error: Pick<OrderingRouteError, 'code' | 'details'>,
  labels: OrderingLabels,
  extra: { opens?: string | null; allergyNoteMax?: number } = {}
): string {
  if (error.code === 'CLOSED' && extra.opens) return `${labels.errorClosed} ${extra.opens}`;
  if (error.code === 'INVALID_CUSTOMER') {
    const field = CUSTOMER_FIELD[error.details?.reason ?? ''];
    if (field) return fill(labels[field] as string, { n: extra.allergyNoteMax ?? 200 });
  }
  const key = Object.hasOwn(MESSAGE, error.code) ? MESSAGE[error.code] : 'errorGeneric';
  return labels[key] as string;
}

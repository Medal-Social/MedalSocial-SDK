import { describe, expect, it } from 'vitest';
import type { OrderingRouteErrorCode } from '../../src/core/checkout';
import { refusalMessage } from '../../src/core/errors';
import { mergeLabels } from '../../src/core/ui-labels';

const nb = mergeLabels('nb');
const en = mergeLabels('en');

describe('refusalMessage', () => {
  it('error code mapped to copy', () => {
    expect(refusalMessage({ code: 'CLOSED' }, nb, { opens: 'Åpner kl. 11:00' })).toBe(
      'Restauranten tar ikke imot bestillinger nå. Åpner kl. 11:00'
    );
    expect(refusalMessage({ code: 'CLOSED' }, nb)).toBe(
      'Restauranten tar ikke imot bestillinger nå.'
    );
    expect(refusalMessage({ code: 'SOLD_OUT', details: { ids: ['a'] } }, en)).toBe(en.errorSoldOut);
    expect(refusalMessage({ code: 'RETURN_URL_NOT_ALLOWED' }, nb)).toBe(nb.errorVipps);
  });

  it('has words for every code', () => {
    const codes: OrderingRouteErrorCode[] = [
      'CLOSED',
      'CUTOFF',
      'CHANNEL_NOT_AVAILABLE',
      'PREORDER_DISABLED',
      'SLOT_TAKEN',
      'TABLE_NOT_FOUND',
      'SOLD_OUT',
      'UNAVAILABLE',
      'INVALID_OPTIONS',
      'INVALID_CART',
      'PAYMENT_METHOD_NOT_ALLOWED',
      'PAYMENT_UNAVAILABLE',
      'RETURN_URL_NOT_ALLOWED',
      'INVALID_CUSTOMER',
      'QUOTE_NOT_USABLE',
      'QUOTE_EXPIRED',
      'SAVED_ADDRESS_NOT_FOUND',
      'INVALID_REQUEST',
      'ORDER_NOT_FOUND',
      'ORDERING_NOT_ENABLED',
      'IDEMPOTENCY_IN_PROGRESS',
      'IDEMPOTENCY_CONFLICT',
      'RATE_LIMITED',
      'NOT_CONFIGURED',
      'SERVICE_UNAVAILABLE',
    ];
    for (const code of codes) expect(refusalMessage({ code }, nb)).toMatch(/\S/);
  });

  it('names the field for INVALID_CUSTOMER', () => {
    expect(refusalMessage({ code: 'INVALID_CUSTOMER', details: { reason: 'phone' } }, nb)).toBe(
      nb.phoneError
    );
    expect(
      refusalMessage({ code: 'INVALID_CUSTOMER', details: { reason: 'allergy_note' } }, nb)
    ).toBe('Allerginotatet kan være opptil 200 tegn.');
    expect(
      refusalMessage({ code: 'INVALID_CUSTOMER', details: { reason: 'allergy_note' } }, nb, {
        allergyNoteMax: 150,
      })
    ).toBe('Allerginotatet kan være opptil 150 tegn.');
    expect(refusalMessage({ code: 'INVALID_CUSTOMER', details: { reason: 'door' } }, nb)).toBe(
      nb.errorCustomer
    );
    expect(refusalMessage({ code: 'INVALID_CUSTOMER' }, nb)).toBe(nb.errorCustomer);
  });

  it('reads an unknown code as try again', () => {
    expect(refusalMessage({ code: 'NEW_CODE' as OrderingRouteErrorCode }, en)).toBe(
      en.errorGeneric
    );
    expect(refusalMessage({ code: 'toString' as OrderingRouteErrorCode }, en)).toBe(
      en.errorGeneric
    );
  });
});

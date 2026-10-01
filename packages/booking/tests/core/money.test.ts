import { describe, expect, it } from 'vitest';
import { createMoney } from '../../src/core/money';
import { PARITY_CONFIG } from '../support/parity-config';

/**
 * The formatter the parity site printed every price with before this package
 * existed, verbatim — the reference the NOK rule must reproduce byte for byte.
 */
const NBSP = '\u00A0';
function referenceFormatPrice(nok: number): string {
  const formatted = Math.round(nok)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${formatted}${NBSP}kr`;
}

const AMOUNTS = [
  0, 1, 9, 99, 370, 490, 490.4, 490.5, 999, 1000, 1270, 1859.6, 1860, 2940, 12_345, 1_234_567,
];

describe('money — the parity rule for NOK in Norwegian', () => {
  const money = createMoney(PARITY_CONFIG);

  it.each(AMOUNTS)('writes %d kr exactly as before', (amount) => {
    expect(money.formatPrice(amount)).toBe(referenceFormatPrice(amount));
    expect(money.formatMinor(Math.round(amount * 100))).toBe(
      referenceFormatPrice(Math.round(amount * 100) / 100)
    );
  });

  it('uses U+00A0 for both spaces in «1 860 kr»', () => {
    expect(money.formatPrice(1860)).toBe('1\u00A0860\u00A0kr');
    expect(money.formatMinor(186_000)).toBe('1\u00A0860\u00A0kr');
  });

  it('applies to every Norwegian spelling', () => {
    expect(createMoney({ locale: 'no', currency: 'NOK' }).formatPrice(1860)).toBe(
      '1\u00A0860\u00A0kr'
    );
    expect(createMoney({ locale: 'nn-NO', currency: 'NOK' }).formatPrice(1860)).toBe(
      '1\u00A0860\u00A0kr'
    );
  });
});

describe('money — Intl for everything else', () => {
  it('writes NOK the Intl way outside Norwegian', () => {
    expect(createMoney({ locale: 'en-GB', currency: 'NOK' }).formatPrice(1860)).toMatch(
      /^NOK\s1,860$/u
    );
  });

  it('respects a currency with no minor unit', () => {
    const yen = createMoney({ locale: 'en-GB', currency: 'JPY' });
    expect(yen.formatMinor(1860)).toBe('JP¥1,860');
    expect(yen.currency).toBe('JPY');
  });
});

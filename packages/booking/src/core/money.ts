/**
 * The one way a booking site writes an amount of money.
 *
 * Free of React, of `server-only` and of any catalogue: the price pages render
 * these on the server, the wizard re-renders them in the browser. Nothing here
 * knows what anything costs — every figure is passed in, and every figure
 * passed in came off the business's catalogue in Medal.
 *
 * Norwegian kroner keep the hand-written rule they have always had — «1 860 kr»,
 * both spaces U+00A0, whole kroner — rather than `Intl`'s, which spells NOK
 * differently across ICU versions («kr 1 860,00», a narrow no-break space…).
 * Every other locale and currency is `Intl.NumberFormat`.
 */

import type { BookingConfig } from './config';

/** Non-breaking space (U+00A0) — «1 860 kr» must not wrap mid-value. */
const NBSP = '\u00A0';

export interface Money {
  readonly currency: string;
  /** Major units (kroner, pounds) → display. */
  formatPrice(amount: number): string;
  /** Minor units (øre, pence) → display. The wire's unit. */
  formatMinor(minor: number): string;
}

/**
 * Whole kroner, Norwegian-style: `490` → «490 kr», `1860` → «1 860 kr».
 *
 * Both spaces are U+00A0, so neither the thousands separator nor the unit can
 * be broken across a line.
 */
function formatKroner(nok: number): string {
  const formatted = Math.round(nok)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${formatted}${NBSP}kr`;
}

function isNorwegian(locale: string): boolean {
  const language = locale.toLowerCase().split('-')[0];
  return language === 'nb' || language === 'no' || language === 'nn';
}

export function createMoney(config: Pick<BookingConfig, 'locale' | 'currency'>): Money {
  const { currency, locale } = config;
  // Rounded to whole kroner: nothing a salon sells has a half-krone price, and
  // a stray øre on a public price list reads as a bug rather than as precision.
  if (currency === 'NOK' && isNorwegian(locale)) {
    return {
      currency,
      formatPrice: formatKroner,
      formatMinor: (ore) => formatKroner(ore / 100),
    };
  }
  const probe = new Intl.NumberFormat(locale, { style: 'currency', currency });
  /* v8 ignore next -- `Intl` always resolves the digits for a currency format */
  const digits = probe.resolvedOptions().maximumFractionDigits ?? 2;
  // A whole amount is written whole («£12»), anything else to the currency's
  // own precision («£12.50») — never a trailing «.00» on a price list.
  const whole = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const exact = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const formatPrice = (amount: number): string =>
    Number.isInteger(amount) ? whole.format(amount) : exact.format(amount);
  return {
    currency,
    formatPrice,
    formatMinor: (minor) => formatPrice(Math.round(minor) / 10 ** digits),
  };
}

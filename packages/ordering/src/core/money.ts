/**
 * The one way an ordering site writes an amount of money.
 *
 * Every amount on the wire is integer øre (minor units), VAT included, and
 * nothing here knows what anything costs: each figure is passed in, and each
 * figure passed in came off the restaurant's menu in Medal.
 *
 * Norwegian kroner are hand-written rather than left to `Intl`, which spells
 * NOK differently across ICU versions («kr 149,50», «149,50 kr», a narrow
 * no-break space…). The rule: whole kroner are written whole («150 kr»), any
 * øre to two decimals with a comma («149,50 kr»); thousands are grouped, and
 * both the group separator and the space before «kr» are U+00A0, so a price
 * never wraps. A restaurant, unlike a salon, does price in øre, so they are
 * kept rather than rounded away. Every other locale and currency is
 * `Intl.NumberFormat`, whole amounts again without a trailing «.00».
 */

/** Non-breaking space (U+00A0) — «1 234,50 kr» must not wrap mid-value. */
const NBSP = '\u00A0';
/** The minus sign (U+2212) Norwegian typesetting uses, as `Intl` does for nb. */
const MINUS = '\u2212';

export interface MoneyOptions {
  /** BCP 47 locale. Default `nb-NO`. */
  locale?: string;
  /** ISO 4217 currency of the øre/minor amounts. Default `NOK`. */
  currency?: string;
}

export interface Money {
  readonly currency: string;
  /** Minor units (øre) → display: `14950` → «149,50 kr». */
  formatOre(ore: number): string;
  /**
   * A modifier option's price difference, signed: «+ 15 kr», «− 5 kr», and
   * `''` for an option that costs nothing extra.
   */
  formatDeltaOre(ore: number): string;
}

/**
 * Rounded to whole minor units, and refused (RangeError) unless that is a safe
 * integer: NaN, ±Infinity and anything beyond ±2^53 − 1 øre would print as
 * digits that are not the amount.
 */
function wholeMinor(ore: number): number {
  const rounded = Math.round(ore);
  if (!Number.isSafeInteger(rounded)) throw new RangeError(`Not an amount of money: ${ore}`);
  return rounded;
}

function isNorwegian(locale: string): boolean {
  const language = locale.toLowerCase().split('-')[0];
  return language === 'nb' || language === 'no' || language === 'nn';
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Øre, Norwegian-style, without a sign: `14950` → «149,50 kr». */
function formatKroner(absOre: number): string {
  const kroner = Math.floor(absOre / 100);
  const ore = absOre % 100;
  const whole = groupThousands(kroner.toString());
  const amount = ore === 0 ? whole : `${whole},${ore.toString().padStart(2, '0')}`;
  return `${amount}${NBSP}kr`;
}

function norwegianMoney(currency: string): Money {
  return {
    currency,
    formatOre(ore) {
      const rounded = wholeMinor(ore);
      // `Math.round(-0.4)` is -0, which is no amount at all.
      const sign = rounded < 0 ? MINUS : '';
      return `${sign}${formatKroner(Math.abs(rounded))}`;
    },
    formatDeltaOre(ore) {
      const rounded = wholeMinor(ore);
      if (rounded === 0) return '';
      return `${rounded > 0 ? '+' : MINUS}${NBSP}${formatKroner(Math.abs(rounded))}`;
    },
  };
}

function intlMoney(locale: string, currency: string): Money {
  const probe = new Intl.NumberFormat(locale, { style: 'currency', currency });
  /* v8 ignore next -- `Intl` always resolves the digits for a currency format */
  const digits = probe.resolvedOptions().maximumFractionDigits ?? 2;
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
  const format = (minor: number): string => {
    const amount = wholeMinor(minor) / 10 ** digits;
    return (Number.isInteger(amount) ? whole : exact).format(amount);
  };
  return {
    currency,
    formatOre: format,
    formatDeltaOre(ore) {
      const text = format(ore);
      if (Math.round(ore) === 0) return '';
      return ore > 0 ? `+${text}` : text;
    },
  };
}

/** The formatter for a locale and currency (default `nb-NO`, `NOK`). */
export function createMoney(options: MoneyOptions = {}): Money {
  const { locale = 'nb-NO', currency = 'NOK' } = options;
  return currency === 'NOK' && isNorwegian(locale)
    ? norwegianMoney(currency)
    : intlMoney(locale, currency);
}

const DEFAULT_MONEY = createMoney();

/** `createMoney().formatOre`: øre as Norwegian kroner. */
export function formatOre(ore: number): string {
  return DEFAULT_MONEY.formatOre(ore);
}

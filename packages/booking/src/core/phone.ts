/**
 * The booking flow's "never a dead end" affordances hand the visitor to the
 * telephone: a service the business does not take online, a slot inside the
 * lead time, a fully-booked day, a change asked for inside the cancellation
 * window. They all dial the same number, so they all build the link the same
 * way — one rule, in one place.
 *
 * The number itself is always a prop (`config.contact.phone`), and may be
 * missing, so every one of those sentences also has an unlinked form: a `tel:`
 * that dials nothing looks like an offer and fails in the visitor's hand.
 */

import type { BookingConfig } from './config';

/** `22 33 44 55` → `tel:22334455`. Spaces are typography; a phone dials digits. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s/g, '')}`;
}

export interface Phone {
  readonly country: string;
  /** `strict` only for a country with a built-in rule set (`NO` in 0.x). */
  readonly validate: 'strict' | 'loose';
  telHref(phone: string): string;
  /** What the details step submits, out of what the visitor typed. */
  nationalDigits(value: string): string;
  /** Whether the typed value is plausibly a number for this country. */
  looksValid(value: string): boolean;
}

/**
 * Norway, the one strict rule set.
 *
 * The contact is deduplicated on this number, so «400 00 000» and
 * «+4740000000» from one parent must not become two families in the CRM.
 * Spacing goes, and so does a country code they pasted in on top of the `+47`
 * the field already shows.
 *
 * Only `+47` and `0047` are stripped, never a bare leading `47`: `47 12 34 56`
 * is an ordinary eight-digit Norwegian number, and taking the first two digits
 * off it would submit somebody else's phone.
 */
function norwegianDigits(value: string): string {
  return value.replace(/[\s()-]/g, '').replace(/^(?:\+47|0047)/, '');
}

/**
 * Eight digits, and nothing about which digit comes first.
 *
 * A claim about length, so a rule about length: requiring a leading 4 or 9
 * would be a *mobile* rule, and would answer a parent who typed a landline by
 * telling them a digit was missing when eight were present.
 */
function looksNorwegian(value: string): boolean {
  return /^\d{8}$/.test(norwegianDigits(value));
}

/** Anywhere else: separators go, a leading `+` stays, and 6–15 digits is E.164-ish. */
function looseDigits(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

function looksE164ish(value: string): boolean {
  return /^\+?\d{6,15}$/.test(looseDigits(value));
}

export function createPhone(config: Pick<BookingConfig, 'phone'>): Phone {
  const { country } = config.phone;
  if (country === 'NO' && config.phone.validate === 'strict') {
    return {
      country,
      validate: 'strict',
      telHref,
      nationalDigits: norwegianDigits,
      looksValid: looksNorwegian,
    };
  }
  return {
    country,
    validate: 'loose',
    telHref,
    nationalDigits: looseDigits,
    looksValid: looksE164ish,
  };
}

/**
 * The e-mail shape the details step and the create route both check: one
 * `@`, something on each side, a dot in the domain, no spaces — the same rule
 * as meda's `looksLikeEmail`.
 *
 * Loose on purpose: the only job is to refuse an address that cannot receive
 * anything. A stricter pattern rejects real addresses.
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether `value`, trimmed, is a non-blank address of that shape. */
export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && EMAIL_SHAPE.test(trimmed);
}

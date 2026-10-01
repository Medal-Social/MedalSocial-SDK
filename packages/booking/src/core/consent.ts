/**
 * The marketing opt-in on the details step, in one place because two ends need
 * the same one: the checkbox that renders it and the route handler that files
 * it.
 *
 * A consent is not a boolean column. It is a record of a sentence somebody
 * agreed to, on a day, in a wording — which is why the engine's endpoint takes
 * `consent_text` and `version` alongside `granted`, and why the sentence cannot
 * live only inside the component. Two copies would drift on the first rewrite,
 * and the drift would be silent: the box would say one thing and the record
 * would keep another.
 *
 * The sentence and its version are the SITE's (`config.consent.marketing`) —
 * it names the business, and only the business can say what it promises. The
 * version must be bumped whenever the sentence changes: the point of storing it
 * is to answer, years later, *which* wording a given customer agreed to.
 *
 * The box is unticked by default wherever it is rendered. A pre-ticked box is
 * not a consent under GDPR, however much traffic it would buy.
 *
 * Deliberately free of React so a `server-only` route can import it.
 */

import type { BookingConfig } from './config';

/** How the record says where the consent came from — the same word the CRM
 * files the contact itself under. */
export const CONSENT_SOURCE = 'booking';

export interface MarketingConsent {
  text: string;
  version: string;
  source: typeof CONSENT_SOURCE;
}

/** The site's marketing consent, or `null` when it offers no marketing box. */
export function marketingConsent(config: Pick<BookingConfig, 'consent'>): MarketingConsent | null {
  const marketing = config.consent.marketing;
  return marketing === null
    ? null
    : { text: marketing.text, version: marketing.version, source: CONSENT_SOURCE };
}

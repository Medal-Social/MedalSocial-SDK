import { describe, expect, it } from 'vitest';
import { CONSENT_SOURCE, marketingConsent } from '../../src/core/consent';
import { PARITY_CONFIG } from '../support/parity-config';

describe('marketingConsent', () => {
  it('is the site’s sentence and version, filed under the booking source', () => {
    expect(marketingConsent(PARITY_CONFIG)).toEqual({
      text: PARITY_CONFIG.consent.marketing?.text,
      version: 'demo-booking-2026-08',
      source: CONSENT_SOURCE,
    });
    expect(CONSENT_SOURCE).toBe('booking');
  });

  it('is null for a site that offers no marketing box', () => {
    expect(marketingConsent({ consent: { termsUrl: null, marketing: null } })).toBeNull();
  });
});

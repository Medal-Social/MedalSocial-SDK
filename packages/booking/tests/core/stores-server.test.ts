/**
 * The same stores during a server render, where there is no `window`: every
 * read is «nothing stored» and every write a no-op, never a throw.
 */

import { describe, expect, it } from 'vitest';
import { stripVippsReturn } from '../../src/core/portal/vipps-return';
import { createStores } from '../../src/core/stores';

describe('stores without a window', () => {
  const stores = createStores('salon');

  it('reads nothing and writes nothing', () => {
    expect(typeof window).toBe('undefined');
    stores.stashDraft({
      items: [],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    expect(stores.takeDraft()).toBeNull();
    stores.clearDraft();
    stores.stashRebookWho('Jonas');
    expect(stores.takeRebookWho()).toBeNull();
    stores.clearAttempt();
    const attempt = stores.readAttempt();
    expect(typeof attempt.nonce).toBe('string');
    stores.rememberPending(attempt, {
      submission: {
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      },
      submitted: {
        items: [],
        startTs: 0,
        partyMode: 'sequential',
        resourceIds: [],
        stylistNames: [],
      },
    });
    expect(stores.readAttempt().nonce).not.toBe(attempt.nonce);
  });

  it('has no address bar to strip', () => {
    expect(() => stripVippsReturn()).not.toThrow();
  });
});

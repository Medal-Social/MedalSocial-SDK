import { beforeEach, describe, expect, it } from 'vitest';
import { createDraftStore, type WizardDraft } from '../../src/core/draft-store';
import { PARITY_CONFIG } from '../support/parity-config';

const { clearDraft, stashDraft, takeDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);

/**
 * The half-built booking a Vipps login leaves behind.
 *
 * Everything worth pinning here is about what does NOT come back: a draft that
 * has aged out, one written by a clock that has since been corrected, and one
 * that has already been read. The wizard rebuilds through the machine's own
 * actions, so a draft that survives this is still checked against the catalogue
 * before it becomes a basket.
 */

const MINUTE = 60_000;
const NOW = Date.parse('2026-09-03T12:00:00+02:00');

function draft(overrides: Partial<Omit<WizardDraft, 'savedAt'>> = {}) {
  return {
    items: [{ serviceId: 'svc-gutt', bookedForName: 'Jonas', bookedForBirthYear: 2017 }],
    resourceId: 'res-sara',
    partyMode: 'sequential' as const,
    startTs: NOW + 2 * 60 * MINUTE,
    resolvedResourceId: 'res-sara',
    partyResourceIds: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('draft-store', () => {
  it('gives back what was stashed, once', () => {
    stashDraft(draft(), NOW);

    expect(takeDraft(NOW + MINUTE)).toMatchObject({
      resourceId: 'res-sara',
      resolvedResourceId: 'res-sara',
      startTs: NOW + 2 * 60 * MINUTE,
      items: [{ serviceId: 'svc-gutt', bookedForName: 'Jonas', bookedForBirthYear: 2017 }],
    });
    // Read-once: a draft that survived its login would rebuild an abandoned
    // booking under the next parent to open `/bestill` in the same tab.
    expect(takeDraft(NOW + MINUTE)).toBeNull();
  });

  it('refuses a draft that has aged out', () => {
    stashDraft(draft(), NOW);

    expect(takeDraft(NOW + 31 * MINUTE)).toBeNull();
  });

  /**
   * A negative age never exceeds the maximum, so an «older than» check alone
   * treats a future stamp as fresh until the clock catches up with it — which
   * is hours, if the device clock was corrected backwards after the draft was
   * written.
   */
  it('refuses a draft stamped in the future', () => {
    stashDraft(draft(), NOW + 60 * MINUTE);

    expect(takeDraft(NOW)).toBeNull();
  });

  it('refuses a draft with no line items, and one whose service is not a string', () => {
    stashDraft(draft({ items: [] }), NOW);
    expect(takeDraft(NOW)).toBeNull();

    window.sessionStorage.setItem(
      'demo:booking:draft',
      JSON.stringify({ ...draft(), items: [{ serviceId: 7 }], savedAt: NOW })
    );
    expect(takeDraft(NOW)).toBeNull();
  });

  it('survives a value that is not JSON at all', () => {
    window.sessionStorage.setItem('demo:booking:draft', 'not json');

    expect(takeDraft(NOW)).toBeNull();
  });

  it('forgets a draft on demand', () => {
    stashDraft(draft(), NOW);
    clearDraft();

    expect(takeDraft(NOW)).toBeNull();
  });

  /** One tab holds one booking, so a second stash replaces the first. */
  it('keeps only the newest draft', () => {
    stashDraft(draft(), NOW);
    stashDraft(draft({ resourceId: 'res-marcus', resolvedResourceId: 'res-marcus' }), NOW);

    expect(takeDraft(NOW)?.resourceId).toBe('res-marcus');
  });

  it('keeps whether each line is a grown-up, and reads an older draft as unknown', () => {
    stashDraft(
      draft({
        items: [
          { serviceId: 'svc-dame', bookedForName: null, bookedForBirthYear: null, adult: true },
          { serviceId: 'svc-gutt', bookedForName: 'Jonas', bookedForBirthYear: 2017, adult: false },
        ],
      }),
      NOW
    );
    expect(takeDraft(NOW + MINUTE)?.items.map((item) => item.adult)).toEqual([true, false]);

    stashDraft(draft(), NOW);
    expect(takeDraft(NOW + MINUTE)?.items[0].adult).toBeNull();
  });

  it('keeps a line’s person id, and reads an older or malformed one as none', () => {
    const line = { serviceId: 'svc-gutt', bookedForName: 'Jonas', bookedForBirthYear: 2017 };
    stashDraft(
      draft({
        items: [
          { ...line, personId: 'p-1' },
          { ...line, personId: '' },
          { ...line, personId: 7 as unknown as string },
          { ...line, personId: null },
          line,
        ],
      }),
      NOW
    );
    expect(takeDraft(NOW + MINUTE)?.items.map((item) => item.personId)).toEqual([
      'p-1',
      null,
      null,
      null,
      null,
    ]);
  });
});

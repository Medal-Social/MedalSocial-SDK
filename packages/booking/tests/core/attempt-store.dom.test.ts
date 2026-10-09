/**
 * The attempt store — the nonce and the submission that have to outlive a
 * reload of a create request that never answered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTEMPT_TTL_MS, createAttemptStore } from '../../src/core/attempt-store';
import { PARITY_CONFIG } from '../support/parity-config';

const store = createAttemptStore(PARITY_CONFIG.storageNamespace);
const KEY = 'demo:booking:attempt';

const SUBMITTED = {
  items: [],
  startTs: 1,
  partyMode: 'sequential' as const,
  resourceIds: [null],
  stylistNames: [null],
};
const SUBMISSION = {
  items: [{ serviceId: 'svc', startTs: 1 }],
  contact: { phone: '40000000' },
  consentTerms: true,
  consentMarketing: false,
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAttemptStore', () => {
  it('stores under <namespace>:booking:attempt', () => {
    expect(store.ATTEMPT_STORAGE_KEY).toBe(KEY);
  });

  it('mints a nonce on first read and keeps it across reads', () => {
    const first = store.readAttempt();
    expect(first.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.readAttempt()).toEqual({ nonce: first.nonce });
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}')).toMatchObject({
      nonce: first.nonce,
    });
  });

  it('drops a pending submission but keeps its nonce on releasePending', () => {
    const attempt = store.readAttempt();
    store.rememberPending(attempt, { submission: SUBMISSION, submitted: SUBMITTED });

    store.releasePending(attempt);

    // Nothing replayed on the next load, and the next submission is the same attempt.
    expect(store.readAttempt()).toEqual({ nonce: attempt.nonce });
  });

  it('keeps a pending submission, then swaps it for the confirmation', () => {
    const attempt = store.readAttempt();
    store.rememberPending(attempt, { submission: SUBMISSION, submitted: SUBMITTED });
    expect(store.readAttempt()).toEqual({
      nonce: attempt.nonce,
      pending: { submission: SUBMISSION, submitted: SUBMITTED },
    });

    const confirmed = { bookings: [{ id: 'bk-1', manageHref: null }], submitted: SUBMITTED };
    store.rememberConfirmed(attempt, confirmed);
    expect(store.readAttempt()).toEqual({ nonce: attempt.nonce, confirmed });
  });

  it('mints afresh once the attempt is older than its TTL', () => {
    // Pinned for the first read too: a millisecond tick between `now` and the
    // write would leave the record exactly at its TTL, which still counts.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = store.readAttempt();
    clock.mockReturnValue(now + ATTEMPT_TTL_MS + 1);
    expect(store.readAttempt().nonce).not.toBe(old.nonce);
  });

  it('mints afresh over a value that is not an attempt', () => {
    window.sessionStorage.setItem(KEY, 'not json');
    expect(store.readAttempt().nonce).toEqual(expect.any(String));
    window.sessionStorage.setItem(KEY, JSON.stringify({ nonce: 7, at: Date.now() }));
    expect(typeof store.readAttempt().nonce).toBe('string');
  });

  it('forgets the attempt', () => {
    store.readAttempt();
    store.clearAttempt();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('carries on without the guarantee when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(typeof store.readAttempt().nonce).toBe('string');
    expect(() => store.clearAttempt()).not.toThrow();
  });
});

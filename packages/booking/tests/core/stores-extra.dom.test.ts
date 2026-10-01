/**
 * The storage failure paths of the draft and rebook stores, and the
 * combined `createStores`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore } from '../../src/core/draft-store';
import { createRebookStore } from '../../src/core/rebook-store';
import { createStores } from '../../src/core/stores';

const NOW = Date.parse('2026-09-03T12:00:00+02:00');

function refuse(...methods: Array<'getItem' | 'setItem' | 'removeItem'>) {
  for (const method of methods) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('denied');
    });
  }
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createStores', () => {
  it('puts all three stores under one namespace', () => {
    const stores = createStores('salon');
    expect(stores.DRAFT_STORAGE_KEY).toBe('salon:booking:draft');
    expect(stores.ATTEMPT_STORAGE_KEY).toBe('salon:booking:attempt');
    stores.stashRebookWho('Jonas');
    expect(Object.keys(window.sessionStorage)).toEqual(['salon:booking:rebook-who']);
  });
});

describe('draft store', () => {
  const store = createDraftStore('salon');
  const draft = {
    items: [{ serviceId: 'svc', bookedForName: null, bookedForBirthYear: null }],
    resourceId: null,
    partyMode: 'sequential' as const,
    startTs: null,
    resolvedResourceId: null,
    partyResourceIds: null,
  };

  it('drops a seating chart that is not a list of ids', () => {
    window.sessionStorage.setItem(
      'salon:booking:draft',
      JSON.stringify({ ...draft, partyResourceIds: ['res-a', 7], savedAt: NOW })
    );
    expect(store.takeDraft(NOW)?.partyResourceIds).toBeNull();
  });

  it('never throws when storage refuses', () => {
    refuse('getItem', 'setItem', 'removeItem');
    expect(() => store.stashDraft(draft, NOW)).not.toThrow();
    expect(store.takeDraft(NOW)).toBeNull();
    expect(() => store.clearDraft()).not.toThrow();
  });
});

describe('rebook store', () => {
  const store = createRebookStore('salon');

  it('never throws when storage refuses', () => {
    refuse('getItem', 'setItem', 'removeItem');
    expect(() => store.stashRebookWho('Jonas')).not.toThrow();
    expect(() => store.stashRebookWho(null)).not.toThrow();
    expect(store.takeRebookWho()).toBeNull();
  });
});

describe('draft store — the shape check', () => {
  const store = createDraftStore('shape');
  const KEY = 'shape:booking:draft';
  const item = { serviceId: 'svc', bookedForName: null, bookedForBirthYear: null };

  it('refuses a value that is not a draft object, or has no stamp', () => {
    window.sessionStorage.setItem(KEY, '7');
    expect(store.takeDraft(NOW)).toBeNull();
    window.sessionStorage.setItem(KEY, JSON.stringify({ items: [item] }));
    expect(store.takeDraft(NOW)).toBeNull();
  });

  it('keeps a parallel seating chart of ids', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        items: [item, item],
        resourceId: 'res-a',
        partyMode: 'parallel',
        startTs: NOW,
        resolvedResourceId: null,
        partyResourceIds: ['res-a', 'res-b'],
        savedAt: NOW,
      })
    );
    expect(store.takeDraft(NOW)).toMatchObject({
      partyMode: 'parallel',
      partyResourceIds: ['res-a', 'res-b'],
    });
  });
});

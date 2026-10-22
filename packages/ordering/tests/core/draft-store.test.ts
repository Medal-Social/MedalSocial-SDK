import { describe, expect, it } from 'vitest';
import { createDraftStore } from '../../src/core/draft-store';

/** The server render: no `window`, so nothing is read or written, and nothing throws. */
describe('draft store without a browser', () => {
  it('reads no draft and keeps changes in memory only', () => {
    expect(typeof window).toBe('undefined');
    const drafts = createDraftStore({ site: 'demo' });
    expect(drafts.loadDraft()).toBeNull();
    const draft = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    expect(draft.lines).toHaveLength(1);
    expect(drafts.loadDraft()).toBeNull();
    expect(drafts.rotateIdempotencyKey().lines).toEqual([]);
    expect(() => drafts.clearDraft()).not.toThrow();
  });

  it('uses the real clock by default', () => {
    const before = Date.now();
    const draft = createDraftStore({ site: 'demo' }).addLine({
      itemId: 'burger',
      quantity: 1,
      selections: {},
    });
    expect(draft.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

import { describe, expect, it } from 'vitest';
import { createDraftStore, DRAFT_MAX_AGE_MS } from '../../src/core/draft-store';

/** The server render: no `window`, so nothing is read or written, and nothing throws. */
describe('draft store without a browser', () => {
  it('keeps the cart in memory, and never hands it out through loadDraft', () => {
    expect(typeof window).toBe('undefined');
    const drafts = createDraftStore({ site: 'demo' });
    expect(drafts.loadDraft()).toBeNull();
    const first = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const second = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    expect(second.lines.map((line) => line.itemId)).toEqual(['burger', 'fries']);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(drafts.loadDraft()).toBeNull();
    const rotated = drafts.rotateIdempotencyKey();
    expect(rotated.lines).toEqual(second.lines);
    expect(rotated.idempotencyKey).not.toBe(first.idempotencyKey);
    drafts.clearDraft();
    expect(drafts.addLine({ itemId: 'cola', quantity: 1, selections: {} }).lines).toHaveLength(1);
  });

  it('forgets a remembered draft past its age', () => {
    let now = 0;
    const drafts = createDraftStore({ site: 'demo', now: () => now });
    drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    now = DRAFT_MAX_AGE_MS + 1;
    expect(drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} }).lines).toHaveLength(1);
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

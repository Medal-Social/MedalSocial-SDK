import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDraftStore,
  DRAFT_MAX_AGE_MS,
  draftStorageKey,
  MAX_DRAFT_LINES,
  MAX_NOTE_LENGTH,
  MAX_QUANTITY,
  newIdempotencyKey,
  type OrderDraft,
} from '../../src/core/draft-store';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function store(locationId?: string) {
  let now = NOW;
  const drafts = createDraftStore({ site: 'demo', locationId, now: () => now });
  return { drafts, advance: (ms: number) => (now += ms) };
}

const KEY = 'demo:ordering:draft:default';
const raw = () => window.localStorage.getItem(KEY);
const stored = () => JSON.parse(raw() as string) as OrderDraft;
const put = (value: unknown) => window.localStorage.setItem(KEY, JSON.stringify(value));

function valid(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    version: 1,
    lines: [{ lineId: 'l1', itemId: 'burger', quantity: 2, selections: { size: ['large'] } }],
    idempotencyKey: 'key-1',
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('draftStorageKey', () => {
  it('keys a draft by site and location, with a default location', () => {
    expect(draftStorageKey('demo')).toBe(KEY);
    expect(draftStorageKey('demo', 'oslo-sentrum')).toBe('demo:ordering:draft:oslo-sentrum');
    expect(draftStorageKey('demo', '')).toBe(KEY);
    expect(store('oslo').drafts.storageKey).toBe('demo:ordering:draft:oslo');
  });
});

describe('newIdempotencyKey', () => {
  it('is a fresh v4 UUID each time', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(UUID);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('falls back to getRandomValues without randomUUID', () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(newIdempotencyKey()).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      });
    }
  });
});

describe('loadDraft', () => {
  it('is null when nothing is stored', () => {
    expect(store().drafts.loadDraft()).toBeNull();
  });

  it('reads back what was saved', () => {
    const { drafts } = store();
    const saved = drafts.saveDraft(valid({ channel: 'dine_in', table: 'T7' }));
    expect(drafts.loadDraft()).toEqual(saved);
    expect(saved.updatedAt).toBe(NOW);
  });

  it('keeps one draft per location', () => {
    const oslo = store('oslo').drafts;
    const bergen = store('bergen').drafts;
    oslo.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    expect(bergen.loadDraft()).toBeNull();
    expect(oslo.loadDraft()?.lines).toHaveLength(1);
  });

  it.each([
    ['not JSON', '{oops'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['another version', JSON.stringify(valid({ version: 2 as 1 }))],
    ['no lines', JSON.stringify({ ...valid(), lines: 'x' })],
    ['no idempotency key', JSON.stringify({ ...valid(), idempotencyKey: '' })],
    ['an overlong key', JSON.stringify(valid({ idempotencyKey: 'k'.repeat(129) }))],
    ['no timestamp', JSON.stringify({ ...valid(), updatedAt: 'now' })],
    ['an expired draft', JSON.stringify(valid({ updatedAt: NOW - DRAFT_MAX_AGE_MS - 1 }))],
    ['a future draft', JSON.stringify(valid({ updatedAt: NOW + 1 }))],
  ])('drops %s, and removes it', (_label, value) => {
    window.localStorage.setItem(KEY, value);
    expect(store().drafts.loadDraft()).toBeNull();
    expect(raw()).toBeNull();
  });

  it('keeps a draft right at its age limit', () => {
    put(valid({ updatedAt: NOW - DRAFT_MAX_AGE_MS }));
    expect(store().drafts.loadDraft()).not.toBeNull();
  });

  it('drops a broken line but keeps the rest', () => {
    put(
      valid({
        lines: [
          { lineId: 'ok', itemId: 'burger', quantity: 1, selections: {} },
          null,
          { lineId: '', itemId: 'burger', quantity: 1, selections: {} },
          { lineId: 'no-item', quantity: 1, selections: {} },
          { lineId: 'zero', itemId: 'burger', quantity: 0, selections: {} },
          { lineId: 'many', itemId: 'burger', quantity: 100, selections: {} },
          { lineId: 'half', itemId: 'burger', quantity: 1.5, selections: {} },
          { lineId: 'dup', itemId: 'burger', quantity: 1, selections: {} },
          { lineId: 'dup', itemId: 'fries', quantity: 1, selections: {} },
        ] as never,
      })
    );
    expect(
      store()
        .drafts.loadDraft()
        ?.lines.map((line) => line.lineId)
    ).toEqual(['ok', 'dup']);
  });

  it('cleans a line it keeps: selections, and a note cut to length', () => {
    put(
      valid({
        lines: [
          {
            lineId: 'l1',
            itemId: 'burger',
            quantity: 3,
            selections: { size: ['large', 7, ''], extras: 'cheese', ok: [] },
            note: 'x'.repeat(MAX_NOTE_LENGTH + 1),
          },
          { lineId: 'l2', itemId: 'fries', quantity: 1, selections: null, note: 'Uten salt' },
          { lineId: 'l3', itemId: 'cola', quantity: 1, selections: ['a'], note: 5 },
        ] as never,
      })
    );
    expect(store().drafts.loadDraft()?.lines).toEqual([
      {
        lineId: 'l1',
        itemId: 'burger',
        quantity: 3,
        selections: { size: ['large'], ok: [] },
        note: 'x'.repeat(MAX_NOTE_LENGTH),
      },
      { lineId: 'l2', itemId: 'fries', quantity: 1, selections: {}, note: 'Uten salt' },
      { lineId: 'l3', itemId: 'cola', quantity: 1, selections: {} },
    ]);
  });

  it('caps the number of lines', () => {
    const lines = Array.from({ length: MAX_DRAFT_LINES + 5 }, (_, i) => ({
      lineId: `l${i}`,
      itemId: 'burger',
      quantity: 1,
      selections: {},
    }));
    put(valid({ lines }));
    expect(store().drafts.loadDraft()?.lines).toHaveLength(MAX_DRAFT_LINES);
  });

  it('drops a channel or table it does not recognise, keeping the draft', () => {
    put({ ...valid(), channel: 'pickup', table: 'a b' });
    const draft = store().drafts.loadDraft();
    expect(draft).not.toBeNull();
    expect(draft).not.toHaveProperty('channel');
    expect(draft).not.toHaveProperty('table');
  });

  it('is null when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(store().drafts.loadDraft()).toBeNull();
  });

  it('is null when a broken value cannot even be removed', () => {
    window.localStorage.setItem(KEY, '{oops');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(store().drafts.loadDraft()).toBeNull();
  });
});

describe('saveDraft', () => {
  it('stamps the time and normalises what it writes', () => {
    const { drafts, advance } = store();
    advance(1000);
    const saved = drafts.saveDraft({
      ...valid(),
      channel: 'pickup' as never,
      lines: [{ lineId: 'l1', itemId: 'burger', quantity: 500, selections: {}, note: '  ' }],
    });
    expect(saved.updatedAt).toBe(NOW + 1000);
    expect(saved).not.toHaveProperty('channel');
    expect(saved.lines[0]).toEqual({
      lineId: 'l1',
      itemId: 'burger',
      quantity: MAX_QUANTITY,
      selections: {},
    });
    expect(stored()).toEqual(saved);
  });

  it('gives a draft without a valid key a fresh one', () => {
    const saved = store().drafts.saveDraft({ ...valid(), idempotencyKey: '' });
    expect(saved.idempotencyKey).toMatch(UUID);
  });

  it('cleans what it is handed and never throws on a bad line', () => {
    const saved = store().drafts.saveDraft({
      ...valid(),
      lines: [
        null,
        'line',
        { lineId: '', itemId: 'burger', quantity: 1, selections: {} },
        { lineId: 'ok', itemId: 'burger', quantity: 1, selections: {} },
      ] as never,
    });
    expect(saved.lines.map((line) => line.lineId)).toEqual(['ok']);
    expect(store().drafts.saveDraft({ ...valid(), lines: 'x' as never }).lines).toEqual([]);
  });

  it('drops the table of a takeaway or delivery draft', () => {
    const { drafts } = store();
    expect(drafts.saveDraft(valid({ channel: 'takeaway', table: 'T7' }))).not.toHaveProperty(
      'table'
    );
    expect(drafts.saveDraft(valid({ table: 'T7' })).table).toBe('T7');
    expect(drafts.saveDraft(valid({ channel: 'dine_in', table: 'T7' })).table).toBe('T7');
  });

  it('never takes «__proto__» as a group', () => {
    const selections = JSON.parse('{"__proto__": ["x"], "size": ["large"]}');
    const saved = store().drafts.saveDraft(
      valid({ lines: [{ lineId: 'l1', itemId: 'burger', quantity: 1, selections }] })
    );
    expect(Object.getPrototypeOf(saved.lines[0]?.selections)).toBe(Object.prototype);
    expect(Object.keys(saved.lines[0]?.selections ?? {})).toEqual(['size']);
  });
});

describe('addLine / updateLine / removeLine', () => {
  it('starts a draft with a fresh idempotency key on the first line', () => {
    const { drafts } = store();
    const draft = drafts.addLine({
      itemId: 'burger',
      quantity: 2,
      selections: { size: ['large'], extras: ['cheese', 'bacon'] },
      note: '  Uten løk  ',
    });
    expect(draft.version).toBe(1);
    expect(draft.idempotencyKey).toMatch(UUID);
    expect(draft.lines).toEqual([
      {
        lineId: expect.stringMatching(UUID),
        itemId: 'burger',
        quantity: 2,
        selections: { size: ['large'], extras: ['cheese', 'bacon'] },
        note: 'Uten løk',
      },
    ]);
    expect(stored()).toEqual(draft);
  });

  it('keeps the idempotency key while the cart changes', () => {
    const { drafts } = store();
    const first = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const second = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.lines.map((line) => line.itemId)).toEqual(['burger', 'fries']);
  });

  it('clamps the quantity and trims the note of a new line', () => {
    const { drafts } = store();
    expect(drafts.addLine({ itemId: 'a', quantity: 0, selections: {} }).lines[0]?.quantity).toBe(1);
    expect(drafts.addLine({ itemId: 'b', quantity: 3.7, selections: {} }).lines[1]?.quantity).toBe(
      3
    );
    expect(
      drafts.addLine({ itemId: 'c', quantity: Number.NaN, selections: {} }).lines[2]?.quantity
    ).toBe(1);
    const long = drafts.addLine({
      itemId: 'd',
      quantity: 1,
      selections: {},
      note: 'x'.repeat(250),
    });
    expect(long.lines[3]?.note).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('refuses a line without an item id, leaving the draft as it was', () => {
    const { drafts } = store();
    expect(drafts.addLine({ itemId: '', quantity: 1, selections: {} }).lines).toEqual([]);
  });

  it('stops at the line cap', () => {
    const { drafts } = store();
    for (let i = 0; i < MAX_DRAFT_LINES + 2; i++)
      drafts.addLine({ itemId: `i${i}`, quantity: 1, selections: {} });
    expect(drafts.loadDraft()?.lines).toHaveLength(MAX_DRAFT_LINES);
  });

  it('updates one line by id, and leaves an unknown id alone', () => {
    const { drafts } = store();
    const { lines } = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const lineId = lines[0]?.lineId as string;
    const updated = drafts.updateLine(lineId, {
      quantity: 4,
      selections: { size: ['regular'] },
      note: 'Godt stekt',
    });
    expect(updated.lines[0]).toEqual({
      lineId,
      itemId: 'burger',
      quantity: 4,
      selections: { size: ['regular'] },
      note: 'Godt stekt',
    });
    const kept = drafts.updateLine(lineId, { quantity: undefined, selections: undefined });
    expect(kept.lines[0]).toEqual(updated.lines[0]);
    const cleared = drafts.updateLine(lineId, { note: undefined });
    expect(cleared.lines[0]).not.toHaveProperty('note');
    expect(cleared.lines[0]?.quantity).toBe(4);
    expect(drafts.updateLine('missing', { quantity: 9 })).toEqual(cleared);
  });

  it('removes a line by id', () => {
    const { drafts } = store();
    drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const { lines } = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    const remaining = drafts.removeLine(lines[0]?.lineId as string);
    expect(remaining.lines.map((line) => line.itemId)).toEqual(['fries']);
  });
});

describe('clearDraft / rotateIdempotencyKey', () => {
  it('forgets the draft, so the next one gets a new key', () => {
    const { drafts } = store();
    const before = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    drafts.clearDraft();
    expect(raw()).toBeNull();
    expect(drafts.loadDraft()).toBeNull();
    const after = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
  });

  it('rotates the key and keeps the cart, after an order that went through', () => {
    const { drafts } = store();
    const before = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const after = drafts.rotateIdempotencyKey();
    expect(after.idempotencyKey).toMatch(UUID);
    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
    expect(after.lines).toEqual(before.lines);
    expect(stored().idempotencyKey).toBe(after.idempotencyKey);
  });

  it('clears quietly when storage refuses, and does not read the stale value again', () => {
    const { drafts } = store();
    const before = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => drafts.clearDraft()).not.toThrow();
    expect(raw()).not.toBeNull();
    expect(drafts.loadDraft()).toBeNull();
    const after = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    expect(after.lines.map((line) => line.itemId)).toEqual(['fries']);
    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
  });

  it('starts over after another tab cleared the draft', () => {
    const { drafts } = store();
    drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    window.localStorage.removeItem(KEY);
    expect(drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} }).lines).toHaveLength(1);
  });
});

describe('when storage fails, the cart lives in memory', () => {
  it('keeps every line and one key through a full quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { drafts } = store();
    const first = drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    const second = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    expect(second.lines.map((line) => line.itemId)).toEqual(['burger', 'fries']);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    const lineId = second.lines[0]?.lineId as string;
    const updated = drafts.updateLine(lineId, { quantity: 3 });
    expect(updated.lines[0]?.quantity).toBe(3);
    expect(updated.idempotencyKey).toBe(first.idempotencyKey);
    expect(drafts.loadDraft()).toEqual(updated);
    expect(drafts.removeLine(lineId).lines.map((line) => line.itemId)).toEqual(['fries']);
  });

  it('keeps the cart when storage cannot even be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { drafts } = store();
    expect(drafts.loadDraft()).toBeNull();
    drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    expect(drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} }).lines).toHaveLength(2);
    expect(drafts.loadDraft()?.lines).toHaveLength(2);
  });

  it('forgets the remembered draft past its age', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { drafts, advance } = store();
    drafts.addLine({ itemId: 'burger', quantity: 1, selections: {} });
    advance(DRAFT_MAX_AGE_MS + 1);
    expect(drafts.loadDraft()).toBeNull();
  });
});

describe('markSubmitted', () => {
  const burger = { itemId: 'burger', quantity: 1, selections: {} };

  it('records that the key was sent, and an unchanged retry keeps it', () => {
    const { drafts } = store();
    const before = drafts.addLine(burger);
    const marked = drafts.markSubmitted();
    expect(marked.submitted).toBe(true);
    expect(marked.idempotencyKey).toBe(before.idempotencyKey);
    expect(stored().submitted).toBe(true);
    expect(drafts.loadDraft()?.submitted).toBe(true);
    // A retry with the same cart: saved as it is, the key and the mark stay.
    const again = drafts.saveDraft(drafts.loadDraft() as OrderDraft);
    expect(again.idempotencyKey).toBe(before.idempotencyKey);
    expect(again.submitted).toBe(true);
    // Updating a line that is not there changes nothing either.
    expect(drafts.updateLine('nope', { quantity: 2 }).idempotencyKey).toBe(before.idempotencyKey);
  });

  it('rotates the key and clears the mark when a line is added, changed or removed', () => {
    const { drafts } = store();
    const first = drafts.addLine(burger);
    drafts.markSubmitted();
    const added = drafts.addLine({ itemId: 'fries', quantity: 1, selections: {} });
    expect(added.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(added.submitted).toBeUndefined();
    expect(stored().submitted).toBeUndefined();
    // Unmarked, the cart keeps its key while it changes.
    const lineId = added.lines[0]?.lineId as string;
    expect(drafts.updateLine(lineId, { quantity: 2 }).idempotencyKey).toBe(added.idempotencyKey);

    drafts.markSubmitted();
    const updated = drafts.updateLine(lineId, { quantity: 3 });
    expect(updated.idempotencyKey).not.toBe(added.idempotencyKey);
    expect(updated.submitted).toBeUndefined();

    drafts.markSubmitted();
    const removed = drafts.removeLine(lineId);
    expect(removed.idempotencyKey).not.toBe(updated.idempotencyKey);
    expect(removed.submitted).toBeUndefined();
  });

  it('rotates when saveDraft changes the context, or drops the mark by hand', () => {
    const { drafts } = store();
    drafts.addLine(burger);
    const marked = drafts.markSubmitted();
    const takeaway = drafts.saveDraft({ ...marked, channel: 'takeaway' });
    expect(takeaway.idempotencyKey).not.toBe(marked.idempotencyKey);
    expect(takeaway.submitted).toBeUndefined();

    const markedAgain = drafts.markSubmitted();
    const { submitted: _dropped, ...unmarked } = markedAgain;
    const moreLines = drafts.saveDraft({
      ...unmarked,
      lines: [...unmarked.lines, { lineId: 'l2', itemId: 'cola', quantity: 1, selections: {} }],
    });
    expect(moreLines.idempotencyKey).not.toBe(markedAgain.idempotencyKey);
    expect(moreLines.submitted).toBeUndefined();
  });

  it('rotates a marked draft it cannot compare: nothing stored, or another key', () => {
    const { drafts } = store();
    const orphan = drafts.saveDraft(valid({ submitted: true }));
    expect(orphan.idempotencyKey).not.toBe('key-1');
    expect(orphan.submitted).toBeUndefined();

    const other = drafts.saveDraft(valid({ idempotencyKey: 'key-2', submitted: true }));
    expect(other.idempotencyKey).not.toBe('key-2');
    expect(other.submitted).toBeUndefined();
  });

  it('rotateIdempotencyKey clears the mark and keeps the lines', () => {
    const { drafts } = store();
    const first = drafts.addLine(burger);
    drafts.markSubmitted();
    const rotated = drafts.rotateIdempotencyKey();
    expect(rotated.submitted).toBeUndefined();
    expect(rotated.lines).toEqual(first.lines);
    expect(rotated.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('reads the mark back only as `true`', () => {
    put(valid({ submitted: true }));
    expect(store().drafts.loadDraft()?.submitted).toBe(true);
    put({ ...valid(), submitted: 'yes' });
    expect(store().drafts.loadDraft()).not.toHaveProperty('submitted');
  });
});

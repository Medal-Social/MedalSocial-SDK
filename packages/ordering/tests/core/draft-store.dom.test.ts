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

  it('survives a full storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(store().drafts.saveDraft(valid()).lines).toHaveLength(1);
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
    const cleared = drafts.updateLine(lineId, { note: '' });
    expect(cleared.lines[0]).not.toHaveProperty('note');
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

  it('clears quietly when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => store().drafts.clearDraft()).not.toThrow();
  });
});

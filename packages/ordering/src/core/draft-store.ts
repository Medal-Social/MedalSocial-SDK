/**
 * The guest's cart while they build it: a draft in `localStorage`, one per
 * site and ordering location, so a reload, a closed tab or a phone that
 * locked mid-order brings the cart back.
 *
 * IDS AND CHOICES ONLY — no prices, no names, nothing personal. Prices are
 * read from the menu the page has just fetched, and the server prices the
 * order again regardless, so a draft written before a price change cannot
 * charge the old price. A line naming a dish the menu no longer has is the
 * page's to drop.
 *
 * The draft carries the order's idempotency key, so a submit retried after a
 * dropped connection cannot place the order twice. The key stays while the
 * cart changes; `rotateIdempotencyKey()` after an order that went through,
 * and `clearDraft()` (the next draft gets a new key), start a new one.
 *
 * Nothing here trusts the jar or throws: no storage during the server render,
 * Safari private mode, a full quota, a value some other script wrote — each
 * falls back to «no draft» (or an in-memory one). A draft older than a day is
 * forgotten; the menu, and the guest's appetite, have moved on.
 */
import type { OrderingChannel } from '@medalsocial/sdk';
import { parseChannel, parseTable } from './deep-link';

export const DRAFT_VERSION = 1;
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_QUANTITY = 99;
export const MAX_NOTE_LENGTH = 200;
export const MAX_DRAFT_LINES = 50;
const MAX_KEY_LENGTH = 128;
const DEFAULT_LOCATION = 'default';

export interface DraftLine {
  /** This line's own id, so two of the same dish with different choices stay apart. */
  lineId: string;
  itemId: string;
  /** A whole number, 1 to `MAX_QUANTITY`. */
  quantity: number;
  /** Option ids per modifier group id. */
  selections: Record<string, string[]>;
  /** The guest's note to the kitchen, at most `MAX_NOTE_LENGTH` characters. */
  note?: string;
}

export interface OrderDraft {
  version: typeof DRAFT_VERSION;
  channel?: OrderingChannel;
  table?: string;
  lines: DraftLine[];
  idempotencyKey: string;
  /** When it was last written (ms since the epoch). */
  updatedAt: number;
}

export type NewDraftLine = Omit<DraftLine, 'lineId'>;
export type DraftLinePatch = Partial<Omit<DraftLine, 'lineId' | 'itemId'>>;

export interface DraftStoreOptions {
  /** A prefix of the site's own, so two sites on one origin keep two carts. */
  site: string;
  /** The ordering location; one draft each. Default `'default'`. */
  locationId?: string;
  /** The clock, for tests. Default `Date.now`. */
  now?: () => number;
}

export interface DraftStore {
  readonly storageKey: string;
  /** The stored draft, or `null` when there is none (or none worth keeping). */
  loadDraft(): OrderDraft | null;
  /** Write a draft, cleaned and stamped; returns what was written. */
  saveDraft(draft: OrderDraft): OrderDraft;
  /** Forget the draft. The next one starts with a fresh idempotency key. */
  clearDraft(): void;
  addLine(line: NewDraftLine): OrderDraft;
  updateLine(lineId: string, patch: DraftLinePatch): OrderDraft;
  removeLine(lineId: string): OrderDraft;
  /** A new idempotency key on the current cart — after an order that went through. */
  rotateIdempotencyKey(): OrderDraft;
}

/** `<site>:ordering:draft:<location>`. A storage key, not a credential. */
export function draftStorageKey(site: string, locationId?: string): string {
  return `${site}:ordering:draft:${locationId || DEFAULT_LOCATION}`;
}

/** A fresh v4 UUID for an order's `Idempotency-Key`. */
export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function cleanQuantity(value: unknown): number {
  const quantity = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(MAX_QUANTITY, Math.max(1, quantity));
}

function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const note = value.trim().slice(0, MAX_NOTE_LENGTH);
  return note === '' ? undefined : note;
}

function cleanSelections(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const selections: Record<string, string[]> = {};
  for (const [groupId, optionIds] of Object.entries(value)) {
    if (Array.isArray(optionIds)) selections[groupId] = optionIds.filter(isId);
  }
  return selections;
}

function line(lineId: string, itemId: string, value: Partial<DraftLine>): DraftLine {
  const note = cleanNote(value.note);
  return {
    lineId,
    itemId,
    quantity: cleanQuantity(value.quantity),
    selections: cleanSelections(value.selections),
    ...(note === undefined ? {} : { note }),
  };
}

/** A stored line, or `null`: one the guest could not have made is dropped, not repaired. */
function storedLine(value: unknown): DraftLine | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Partial<DraftLine>;
  if (!isId(stored.lineId) || !isId(stored.itemId)) return null;
  const { quantity } = stored;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
  if (quantity < 1 || quantity > MAX_QUANTITY) return null;
  return line(stored.lineId, stored.itemId, stored);
}

function cleanLines(lines: readonly unknown[], strict: boolean): DraftLine[] {
  const seen = new Set<string>();
  const out: DraftLine[] = [];
  for (const value of lines) {
    const cleaned = strict
      ? storedLine(value)
      : line((value as DraftLine).lineId, (value as DraftLine).itemId, value as DraftLine);
    if (cleaned === null || seen.has(cleaned.lineId)) continue;
    seen.add(cleaned.lineId);
    out.push(cleaned);
    if (out.length === MAX_DRAFT_LINES) break;
  }
  return out;
}

function withContext(
  base: Omit<OrderDraft, 'channel' | 'table'>,
  channel: unknown,
  table: unknown
): OrderDraft {
  const parsedChannel = parseChannel(typeof channel === 'string' ? channel : null);
  const parsedTable = parseTable(typeof table === 'string' ? table : null);
  return {
    ...base,
    ...(parsedChannel === null ? {} : { channel: parsedChannel }),
    ...(parsedTable === null ? {} : { table: parsedTable }),
  };
}

const isKey = (value: unknown): value is string => isId(value) && value.length <= MAX_KEY_LENGTH;

/** The shape and age check on what came out of storage. */
function asDraft(value: unknown, now: number): OrderDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const draft = value as Partial<OrderDraft>;
  if (draft.version !== DRAFT_VERSION || !Array.isArray(draft.lines)) return null;
  if (!isKey(draft.idempotencyKey) || typeof draft.updatedAt !== 'number') return null;
  // A draft dated in the future is a clock corrected backwards; its negative
  // age would pass an «older than» check indefinitely.
  const age = now - draft.updatedAt;
  if (age < 0 || age > DRAFT_MAX_AGE_MS) return null;
  return withContext(
    {
      version: DRAFT_VERSION,
      lines: cleanLines(draft.lines, true),
      idempotencyKey: draft.idempotencyKey,
      updatedAt: draft.updatedAt,
    },
    draft.channel,
    draft.table
  );
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** The draft store for one site and location. */
export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const storageKey = draftStorageKey(options.site, options.locationId);
  const now = options.now ?? Date.now;

  function remove(): void {
    try {
      storage()?.removeItem(storageKey);
    } catch {
      // A value that cannot be removed is dropped again on the next read.
    }
  }

  function loadDraft(): OrderDraft | null {
    let raw: string | null | undefined;
    try {
      raw = storage()?.getItem(storageKey);
    } catch {
      return null;
    }
    if (raw === null || raw === undefined) return null;
    let draft: OrderDraft | null = null;
    try {
      draft = asDraft(JSON.parse(raw), now());
    } catch {
      // Not JSON: someone else's value, or a torn write.
    }
    if (draft === null) remove();
    return draft;
  }

  function saveDraft(draft: OrderDraft): OrderDraft {
    const saved = withContext(
      {
        version: DRAFT_VERSION,
        lines: cleanLines(draft.lines, false),
        idempotencyKey: isKey(draft.idempotencyKey) ? draft.idempotencyKey : newIdempotencyKey(),
        updatedAt: now(),
      },
      draft.channel,
      draft.table
    );
    try {
      storage()?.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Quota or storage turned off: the cart lives as long as the page.
    }
    return saved;
  }

  function current(): OrderDraft {
    return (
      loadDraft() ?? {
        version: DRAFT_VERSION,
        lines: [],
        idempotencyKey: newIdempotencyKey(),
        updatedAt: now(),
      }
    );
  }

  function addLine(input: NewDraftLine): OrderDraft {
    const draft = current();
    if (!isId(input.itemId) || draft.lines.length >= MAX_DRAFT_LINES) return saveDraft(draft);
    return saveDraft({
      ...draft,
      lines: [...draft.lines, line(newIdempotencyKey(), input.itemId, input)],
    });
  }

  function updateLine(lineId: string, patch: DraftLinePatch): OrderDraft {
    const draft = current();
    return saveDraft({
      ...draft,
      lines: draft.lines.map((existing) =>
        existing.lineId === lineId
          ? line(existing.lineId, existing.itemId, { ...existing, ...patch })
          : existing
      ),
    });
  }

  function removeLine(lineId: string): OrderDraft {
    const draft = current();
    return saveDraft({ ...draft, lines: draft.lines.filter((l) => l.lineId !== lineId) });
  }

  function rotateIdempotencyKey(): OrderDraft {
    return saveDraft({ ...current(), idempotencyKey: newIdempotencyKey() });
  }

  return {
    storageKey,
    loadDraft,
    saveDraft,
    clearDraft: remove,
    addLine,
    updateLine,
    removeLine,
    rotateIdempotencyKey,
  };
}

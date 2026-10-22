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
 * dropped connection cannot place the order twice. Its lifecycle:
 *
 * 1. The key stays while the cart changes, until the order is sent.
 * 2. `markSubmitted()` just before sending the order with it: the draft
 *    records that this key has been sent.
 * 3. A retry of the SAME cart (a dropped connection, a reload) keeps the key
 *    and the mark, so the server answers the first order instead of placing
 *    a second one.
 * 4. Any change to the lines or the context after that (`addLine`,
 *    `updateLine`, `removeLine`, or `saveDraft` with other content) gets a new
 *    key and clears the mark: a changed cart is a new order, and the server
 *    would otherwise answer it with the order already placed.
 * 5. After a confirmed order, `clearDraft()`: the cart is done and the next
 *    draft starts with a new key. `rotateIdempotencyKey()` keeps the lines
 *    under a new key — for sending the same cart again as a NEW order on
 *    purpose, not for finishing one.
 *
 * Nothing here trusts the jar or throws. A value some other script wrote, or
 * one past its age, is dropped. When storage cannot be used — no `window`
 * during the server render, Safari private mode, a full quota — the store
 * keeps the draft in memory instead, so the cart and its key still last as
 * long as the page: the mutators build on the last draft they wrote, and
 * `loadDraft()` returns it once storage has failed in the browser. (`loadDraft()`
 * stays `null` without a `window`, so it never hands one server render's cart
 * to another; the mutators still build on the store's memory, so create a
 * store per request on the server.) While storage works it is the only source,
 * so another tab's `clearDraft()` is not undone from memory. A draft older
 * than a day is forgotten; the menu, and the guest's appetite, have moved on.
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
  /**
   * `true` once `markSubmitted()` recorded that `idempotencyKey` was sent with
   * this content. Any later change to the lines or context rotates the key and
   * clears it.
   */
  submitted?: true;
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
  /**
   * Write a draft, cleaned and stamped; returns what was written. When the key
   * was sent (`submitted`, on this draft or on the stored one with the same
   * key) and the lines or context differ from the stored draft's, the key is
   * rotated and the mark cleared; an unchanged save keeps both.
   */
  saveDraft(draft: OrderDraft): OrderDraft;
  /** Forget the draft. The next one starts with a fresh idempotency key. */
  clearDraft(): void;
  /**
   * Add a line with a fresh `lineId`. A line without an item id, or one past
   * `MAX_DRAFT_LINES`, is not added: the draft comes back (and is saved) as
   * it was.
   */
  addLine(line: NewDraftLine): OrderDraft;
  /**
   * Change one line. `quantity` or `selections` left `undefined` keep their
   * value; a `note` key that is present — `undefined` or `''` included —
   * replaces the note, so `{ note: undefined }` clears it. An unknown
   * `lineId` changes nothing.
   */
  updateLine(lineId: string, patch: DraftLinePatch): OrderDraft;
  removeLine(lineId: string): OrderDraft;
  /**
   * A new idempotency key on the current cart, lines kept, mark cleared — to
   * send the same cart again as a new order. After a confirmed order use
   * `clearDraft()` instead.
   */
  rotateIdempotencyKey(): OrderDraft;
  /**
   * Record that the current key is being sent with the current cart. Call it
   * right before the order request; retries of the same cart keep the key, and
   * the next change to the cart rotates it.
   */
  markSubmitted(): OrderDraft;
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
    // `__proto__` as a key would set the record's prototype, not a group.
    if (groupId !== '__proto__' && Array.isArray(optionIds))
      selections[groupId] = optionIds.filter(isId);
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

/**
 * A line, or `null` when it has no `lineId` or `itemId`. A STORED line (`strict`)
 * is also dropped when its quantity is not a whole number in range — the guest
 * could not have made it, so it is dropped rather than repaired; a line being
 * saved has its quantity clamped instead.
 */
function asLine(value: unknown, strict: boolean): DraftLine | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<DraftLine>;
  if (!isId(candidate.lineId) || !isId(candidate.itemId)) return null;
  if (strict) {
    const { quantity } = candidate;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
    if (quantity < 1 || quantity > MAX_QUANTITY) return null;
  }
  return line(candidate.lineId, candidate.itemId, candidate);
}

function cleanLines(lines: readonly unknown[], strict: boolean): DraftLine[] {
  const seen = new Set<string>();
  const out: DraftLine[] = [];
  for (const value of lines) {
    const cleaned = asLine(value, strict);
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
  // A table belongs to a dine-in order only, as in `parseOrderLink`.
  const parsedTable =
    parsedChannel === null || parsedChannel === 'dine_in'
      ? parseTable(typeof table === 'string' ? table : null)
      : null;
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
      ...(draft.submitted === true ? { submitted: true as const } : {}),
      updatedAt: draft.updatedAt,
    },
    draft.channel,
    draft.table
  );
}

/** What an order is made of: the lines and the context. Not the key, the mark or the time. */
function content(draft: OrderDraft): string {
  return JSON.stringify([draft.lines, draft.channel ?? null, draft.table ?? null]);
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/** The draft store for one site and location. */
export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const storageKey = draftStorageKey(options.site, options.locationId);
  const now = options.now ?? Date.now;
  /** The last draft this store wrote: the cart when storage cannot hold it. */
  let memory: OrderDraft | null = null;
  /** Storage threw in this page: memory is the source from now on. */
  let storageFailed = false;

  function remembered(): OrderDraft | null {
    if (memory !== null && now() - memory.updatedAt > DRAFT_MAX_AGE_MS) memory = null;
    return memory;
  }

  function remove(): void {
    try {
      storage()?.removeItem(storageKey);
    } catch {
      // A stale value may still be readable; stop reading it.
      storageFailed = true;
    }
  }

  /** What storage holds; `undefined` when storage cannot be used. */
  function stored(): OrderDraft | null | undefined {
    if (typeof window === 'undefined' || storageFailed) return undefined;
    let raw: string | null;
    try {
      // Reading `localStorage` itself throws where storage is blocked.
      raw = window.localStorage.getItem(storageKey);
    } catch {
      storageFailed = true;
      return undefined;
    }
    if (raw === null) return null;
    let draft: OrderDraft | null = null;
    try {
      draft = asDraft(JSON.parse(raw), now());
    } catch {
      // Not JSON: someone else's value, or a torn write.
    }
    if (draft === null) remove();
    return draft;
  }

  function loadDraft(): OrderDraft | null {
    const draft = stored();
    if (draft !== undefined) return draft;
    // No `window`: a server render, where memory may be another request's.
    return typeof window === 'undefined' ? null : remembered();
  }

  /** The draft as it stands (storage, or memory once storage failed), without making one. */
  function latest(): OrderDraft | null {
    const draft = stored();
    return draft === undefined ? remembered() : draft;
  }

  function saveDraft(draft: OrderDraft): OrderDraft {
    const cleaned = withContext(
      {
        version: DRAFT_VERSION,
        lines: cleanLines(Array.isArray(draft.lines) ? draft.lines : [], false),
        idempotencyKey: isKey(draft.idempotencyKey) ? draft.idempotencyKey : newIdempotencyKey(),
        updatedAt: now(),
      },
      draft.channel,
      draft.table
    );
    const previous = latest();
    const sameKey = previous?.idempotencyKey === cleaned.idempotencyKey;
    const sent = draft.submitted === true || (sameKey && previous?.submitted === true);
    if (!sent) return write(cleaned);
    // A sent key may only be reused for exactly what was sent with it.
    if (sameKey && content(previous as OrderDraft) === content(cleaned)) {
      return write({ ...cleaned, submitted: true });
    }
    return write({ ...cleaned, idempotencyKey: newIdempotencyKey() });
  }

  function write(saved: OrderDraft): OrderDraft {
    memory = saved;
    try {
      storage()?.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Quota or storage turned off: the cart lives in memory, as long as the page.
      storageFailed = true;
    }
    return saved;
  }

  function clearDraft(): void {
    memory = null;
    remove();
  }

  function current(): OrderDraft {
    const draft = stored();
    return (
      (draft === undefined ? remembered() : draft) ?? {
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
      lines: draft.lines.map((existing) => {
        if (existing.lineId !== lineId) return existing;
        const next: Partial<DraftLine> = { ...existing };
        if (patch.quantity !== undefined) next.quantity = patch.quantity;
        if (patch.selections !== undefined) next.selections = patch.selections;
        if ('note' in patch) next.note = patch.note;
        return line(existing.lineId, existing.itemId, next);
      }),
    });
  }

  function removeLine(lineId: string): OrderDraft {
    const draft = current();
    return saveDraft({ ...draft, lines: draft.lines.filter((l) => l.lineId !== lineId) });
  }

  function rotateIdempotencyKey(): OrderDraft {
    const { submitted: _sent, ...draft } = current();
    return saveDraft({ ...draft, idempotencyKey: newIdempotencyKey() });
  }

  function markSubmitted(): OrderDraft {
    return write({ ...current(), submitted: true, updatedAt: now() });
  }

  return {
    storageKey,
    loadDraft,
    saveDraft,
    clearDraft,
    addLine,
    updateLine,
    removeLine,
    rotateIdempotencyKey,
    markSubmitted,
  };
}

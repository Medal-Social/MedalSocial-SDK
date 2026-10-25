/**
 * The menu route: a Next App Router `GET` handler the browser reads the menu
 * through, so the workspace API key never leaves the server.
 *
 * ```ts
 * // app/api/ordering/menu/route.ts
 * export const GET = createMenuRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * ```
 *
 * The handler reads `request.url`, so Next treats the route as dynamic and
 * leaves caching to the `Cache-Control` the handler sets — that is the
 * "ISR 60 s": no `export const revalidate` is needed (add
 * `export const dynamic = 'force-dynamic'` only if a build tries to
 * prerender it).
 *
 * Built on Web `Request`/`Response` only — nothing from `next` is imported, so
 * it runs the same on Node, OpenNext on Workers or in a test.
 *
 * Two caches, both keyed by the ETag Medal sends with the menu:
 *
 * - SERVER: the last menu per channel (and location), revalidated with Medal
 *   at most every `revalidateSeconds` with `If-None-Match`. A 304 restarts the
 *   window and keeps the menu; requests that arrive while a revalidation is in
 *   flight share it. A read for a given `at` (rounded down to the minute,
 *   inside Medal's window of one day back to 60 days ahead) is cached the
 *   same way in a 100-entry LRU. Timed reads that miss that cache are
 *   budgeted: at most `maxTimedReadsPerWindow` Medal calls per window per
 *   route instance, then `503` without a call — so a script walking through
 *   instants costs the site's key a bounded number of calls per window and
 *   per instance (isolate), not one per request. The caches live in this
 *   process (one per Workers isolate); pass `store` to share the current
 *   menu between them.
 * - CDN/BROWSER: `Cache-Control: public, s-maxage, stale-while-revalidate`
 *   plus `ETag`, and a `304` for an `If-None-Match` that is still current.
 *
 * Why `public` when Medal marks the menu `private, no-store`: Medal keys the
 * answer by the caller's API key, so a shared cache in front of Medal must not
 * keep it. This route has no key on the way in — every visitor to the site
 * gets the same menu, which is the restaurant's public menu — so a CDN may
 * keep it.
 *
 * Failures answer `{ error: { code, message } }` with fixed words: never the
 * key, an upstream URL, a header, Medal's own message or a stack. When Medal
 * fails transiently (5xx, 429, network, timeout) and a menu is cached, the
 * cached menu is served instead (stale-if-error) and Medal is asked again a
 * window later. When Medal refuses (ordering switched off, key rejected) the
 * cached menu is dropped and the error answered.
 */

import type { OrderingChannel, OrderingMenu, OrderingMenuResult } from '@medalsocial/sdk';
import { Medal, MedalApiError } from '@medalsocial/sdk';
import { parseChannel, parseOrderLink } from '../core/deep-link';
import { matchesIfNoneMatch, toEntityTag } from './etag';

/** The window the server and the CDN keep a menu before asking again. */
export const DEFAULT_REVALIDATE_SECONDS = 60;

/** How long a CDN may keep serving a stale menu while it revalidates, in windows. */
const STALE_WINDOWS = 5;

/** One attempt at Medal; the SDK retries 429/5xx within the deadline below. */
const ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * The whole upstream read, retries included. A visitor (or every visitor
 * sharing the revalidation) waits at most this long; with a cached menu they
 * then get that one.
 */
const DEADLINE_MS = 8_000;

/**
 * One store operation (`get`, `set`, `delete`). A KV or Redis call that hangs
 * past it counts as a miss (or a failed write): the visitor still gets the
 * menu, and a shared revalidation still settles.
 */
const STORE_TIMEOUT_MS = 1_500;

/** How many timed (`?at=`) menus the route keeps. */
const TIMED_ENTRIES = 100;

/** Medal calls for timed reads per window, per route instance. */
const DEFAULT_MAX_TIMED_READS = 20;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Medal's `at` window: one day back to 60 days ahead. */
const AT_PAST_MS = DAY_MS;
const AT_FUTURE_MS = 60 * DAY_MS;

/** The slice of the SDK client the route uses — what a test injects. */
export interface MenuClient {
  ordering: {
    menu(
      options: {
        channel: OrderingChannel;
        location?: string;
        at?: string;
        ifNoneMatch?: string;
      },
      request?: { signal?: AbortSignal }
    ): Promise<OrderingMenuResult>;
  };
}

/** A cached menu, its ETag and when Medal last confirmed it (`Date.now()` ms). */
export interface MenuCacheEntry {
  etag: string;
  menu: OrderingMenu;
  checkedAt: number;
}

/**
 * Where the server keeps the menu between requests. The default is a map in
 * this process. A store that throws, or takes longer than 1.5 s on one call,
 * is treated as a miss (or a failed write) — the route still answers from
 * Medal.
 */
export interface MenuStore {
  get(key: string): MenuCacheEntry | undefined | Promise<MenuCacheEntry | undefined>;
  set(key: string, entry: MenuCacheEntry): void | Promise<void>;
  /** Forget a menu Medal no longer serves (ordering switched off, key refused). */
  delete(key: string): void | Promise<void>;
}

export interface MenuRouteOptions {
  /**
   * The workspace API key (`process.env.MEDAL_API_KEY`). Checked on the first
   * request, so a build without it still succeeds; a missing key answers
   * `500 NOT_CONFIGURED`.
   */
  apiKey: string;
  /** The Medal API origin. Default: the SDK's (`https://io.medalsocial.com`). */
  baseUrl?: string;
  /** A ready client instead of one built from `apiKey`/`baseUrl` (tests, custom setups). */
  medal?: MenuClient;
  /** Server and CDN cache window in seconds, a positive integer. Default 60. */
  revalidateSeconds?: number;
  /**
   * Most Medal calls for `?at=` reads per `revalidateSeconds` window in this
   * route instance; past it a timed read that is not cached answers `503
   * MENU_UNAVAILABLE`. A non-negative integer; `0` turns timed reads off.
   * Default 20.
   */
  maxTimedReadsPerWindow?: number;
  /** The channel when the request names none (and no table). Default `'takeaway'`. */
  defaultChannel?: OrderingChannel;
  /** The ordering location to read. Never taken from the request. */
  location?: string;
  /**
   * Where the server keeps the current menu. Default: a map in this process
   * — on Workers that is one per isolate, each warming on its own; pass a
   * KV- or Redis-backed store to share it.
   */
  store?: MenuStore;
  /**
   * Put in front of every store key as `<prefix>:`, so routes (sites,
   * locations, environments) sharing one KV or Redis never read each other's
   * menu. Required with `store` — a missing or blank one throws a
   * `RangeError` when the route is created; optional otherwise.
   */
  storeKeyPrefix?: string;
  /**
   * The platform's background hook, read per request (on OpenNext:
   * `(p) => getCloudflareContext().ctx.waitUntil(p)`). A revalidation shared
   * by several visitors is handed to it, so it finishes and is stored even
   * when the request that started it goes away. A throw here is ignored.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Told about every failed Medal read (the SDK's error, unchanged — SDK
   * errors carry no request headers). For the site's logger; a throw here is
   * ignored.
   */
  onError?: (error: unknown) => void;
}

type ErrorBody = { status: number; code: string; message: string };

const NOT_CONFIGURED: ErrorBody = {
  status: 500,
  code: 'NOT_CONFIGURED',
  message: 'The menu is not configured.',
};
const INVALID_CHANNEL: ErrorBody = {
  status: 400,
  code: 'INVALID_CHANNEL',
  message: 'channel must be dine_in, takeaway or delivery.',
};
const INVALID_AT: ErrorBody = {
  status: 400,
  code: 'INVALID_AT',
  message: 'at must be an ISO 8601 date-time with a zone, or Unix milliseconds.',
};

/**
 * `error` as an API failure, or `null`. Besides `instanceof`, an error named
 * `MedalApiError` with a numeric `status` counts: a site with two copies of
 * the SDK installed throws the other copy's class.
 */
function apiFailure(error: unknown): { status: number; code: unknown } | null {
  if (error instanceof MedalApiError) return error;
  if (
    error instanceof Error &&
    error.name === 'MedalApiError' &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return error as unknown as { status: number; code: unknown };
  }
  return null;
}

/**
 * Whether Medal may answer differently soon: a 5xx, a 429, or no answer at
 * all (network, timeout, abort). Only these serve a stale menu; a refusal
 * (ordering off, key rejected) drops it.
 */
function isTransient(error: unknown): boolean {
  const failure = apiFailure(error);
  return failure === null || failure.status >= 500 || failure.status === 429;
}

/** The timed-read budget is spent for this window. */
class TimedBudgetSpent extends Error {}

const UNAVAILABLE_NOW = 'The menu is not available right now.';

/**
 * A Medal failure in the site's words. `ORDERING_NOT_ENABLED` is a 404, not a
 * 503: the workspace has no online ordering, so there is no menu here to
 * find, and a 503 would tell clients and CDNs to keep retrying something
 * that will not come back on its own.
 */
function classify(error: unknown): ErrorBody {
  if (error instanceof TimedBudgetSpent) {
    return { status: 503, code: 'MENU_UNAVAILABLE', message: UNAVAILABLE_NOW };
  }
  const failure = apiFailure(error);
  if (failure) {
    if (failure.code === 'ORDERING_NOT_ENABLED') {
      return {
        status: 404,
        code: 'ORDERING_NOT_ENABLED',
        message: 'Online ordering is not enabled.',
      };
    }
    if (failure.status === 400) {
      return { status: 400, code: 'INVALID_REQUEST', message: 'The menu request was not valid.' };
    }
    if (failure.status === 429) {
      return {
        status: 503,
        code: 'MENU_UNAVAILABLE',
        message: UNAVAILABLE_NOW,
      };
    }
  }
  return { status: 502, code: 'MENU_UNAVAILABLE', message: UNAVAILABLE_NOW };
}

function errorResponse({ status, code, message }: ErrorBody): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}

const DIGITS = /^\d{1,16}$/;
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * `?at=` in Unix milliseconds rounded down to the minute: `undefined` when
 * absent, `null` when malformed or outside Medal's window (checked here, so
 * a bad value never costs a Medal call).
 */
function parseAt(raw: string | null, now: number): number | undefined | null {
  if (raw === null) return undefined;
  const value = raw.trim();
  let ms = Number.NaN;
  if (DIGITS.test(value)) ms = Number(value);
  else if (ISO_WITH_ZONE.test(value)) ms = Date.parse(value);
  if (!Number.isSafeInteger(ms)) return null;
  const minute = ms - (ms % MINUTE_MS);
  return minute >= now - AT_PAST_MS && minute <= now + AT_FUTURE_MS ? minute : null;
}

/**
 * `?channel=` or `?c=` (in that order); a named channel that is not one of
 * the three is an error. With none, a `?t=` table link means dine-in, and
 * anything else gets the default.
 */
function readChannel(params: URLSearchParams, fallback: OrderingChannel): OrderingChannel | null {
  const named = [params.get('channel'), params.get('c')].find((value) => value?.trim());
  if (named) return parseChannel(named);
  return parseOrderLink(params).channel ?? fallback;
}

/** The store's own call, given up after `STORE_TIMEOUT_MS`; a sync throw rejects too. */
async function bounded<T>(call: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('store timed out')), STORE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A map in this process; with `limit`, the least recently used entry goes first. */
function memoryStore(limit = Number.POSITIVE_INFINITY): MenuStore {
  const entries = new Map<string, MenuCacheEntry>();
  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry) {
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    set: (key, entry) => {
      entries.delete(key);
      entries.set(key, entry);
      if (entries.size > limit) entries.delete(entries.keys().next().value as string);
    },
    delete: (key) => {
      entries.delete(key);
    },
  };
}

/** A Next App Router `GET` handler serving the menu as `{ data: OrderingMenu }`. */
export function createMenuRoute(
  options: MenuRouteOptions
): (request: Request) => Promise<Response> {
  const revalidateSeconds = options.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  if (!Number.isSafeInteger(revalidateSeconds) || revalidateSeconds <= 0) {
    throw new RangeError(
      `createMenuRoute: revalidateSeconds must be a positive integer, got ${revalidateSeconds}`
    );
  }
  const maxTimedReads = options.maxTimedReadsPerWindow ?? DEFAULT_MAX_TIMED_READS;
  if (!Number.isSafeInteger(maxTimedReads) || maxTimedReads < 0) {
    throw new RangeError(
      `createMenuRoute: maxTimedReadsPerWindow must be a non-negative integer, got ${maxTimedReads}`
    );
  }
  const prefix = options.storeKeyPrefix;
  if (
    (options.store !== undefined || prefix !== undefined) &&
    (typeof prefix !== 'string' || prefix.trim() === '')
  ) {
    throw new RangeError(
      'createMenuRoute: storeKeyPrefix must be a non-empty string when a store is passed'
    );
  }
  const keyPrefix = prefix === undefined ? '' : `${prefix}:`;
  const budget = { windowStart: Number.NEGATIVE_INFINITY, used: 0 };
  const revalidateMs = revalidateSeconds * 1000;
  const cacheControl = `public, s-maxage=${revalidateSeconds}, stale-while-revalidate=${revalidateSeconds * STALE_WINDOWS}`;
  const defaultChannel = options.defaultChannel ?? 'takeaway';
  const store = options.store ?? memoryStore();
  const timed = memoryStore(TIMED_ENTRIES);
  const inflight = new Map<string, Promise<MenuCacheEntry>>();
  let client = options.medal;

  function medal(): MenuClient | undefined {
    if (client) return client;
    const key = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (key === '') return undefined;
    client = new Medal(key, { baseUrl: options.baseUrl, timeout: ATTEMPT_TIMEOUT_MS });
    return client;
  }

  function report(error: unknown): void {
    try {
      options.onError?.(error);
    } catch {
      // The site's logger failing must not turn into a failed menu.
    }
  }

  async function readStore(from: MenuStore, key: string): Promise<MenuCacheEntry | undefined> {
    try {
      return await bounded(() => from.get(key));
    } catch {
      return undefined;
    }
  }

  async function writeStore(to: MenuStore, key: string, entry: MenuCacheEntry): Promise<void> {
    try {
      await bounded(() => to.set(key, entry));
    } catch {
      // A store that cannot write costs a Medal read next time, nothing more.
    }
  }

  async function dropStore(from: MenuStore, key: string): Promise<void> {
    try {
      await bounded(() => from.delete(key));
    } catch {
      // Left behind, it is still refused at the next revalidation.
    }
  }

  /**
   * One read from Medal. Not tied to the visitor's request signal: a
   * revalidation is shared, and one visitor leaving must not cancel it for
   * the rest.
   */
  async function fetchEntry(
    api: MenuClient,
    channel: OrderingChannel,
    at: string | undefined,
    cached: MenuCacheEntry | undefined
  ): Promise<MenuCacheEntry> {
    const result = await api.ordering.menu(
      { channel, location: options.location, at, ifNoneMatch: cached?.etag },
      { signal: AbortSignal.timeout(DEADLINE_MS) }
    );
    if (!result.notModified) {
      return { etag: result.etag, menu: result.menu, checkedAt: Date.now() };
    }
    if (!cached) throw new Error('Medal answered 304 to a menu read that sent no If-None-Match');
    return { ...cached, etag: result.etag || cached.etag, checkedAt: Date.now() };
  }

  /**
   * Ask Medal again and store the answer. On a transient failure the current
   * menu (not a timed one) is served stale and kept for another window; on a
   * refusal it is dropped.
   */
  async function revalidate(
    api: MenuClient,
    into: MenuStore,
    key: string,
    channel: OrderingChannel,
    at: number | undefined,
    cached: MenuCacheEntry | undefined
  ): Promise<MenuCacheEntry> {
    let entry: MenuCacheEntry;
    try {
      entry = await fetchEntry(
        api,
        channel,
        at === undefined ? undefined : new Date(at).toISOString(),
        cached
      );
    } catch (error) {
      report(error);
      if (!cached || at !== undefined) throw error;
      if (!isTransient(error)) {
        await dropStore(into, key);
        throw error;
      }
      entry = { ...cached, checkedAt: Date.now() };
    }
    await writeStore(into, key, entry);
    return entry;
  }

  /** Take one timed Medal read from this window's budget, or throw. */
  function spendTimedRead(): void {
    const now = Date.now();
    if (now - budget.windowStart >= revalidateMs) {
      budget.windowStart = now;
      budget.used = 0;
    }
    if (budget.used >= maxTimedReads) throw new TimedBudgetSpent();
    budget.used += 1;
  }

  async function cachedMenu(
    api: MenuClient,
    channel: OrderingChannel,
    at: number | undefined
  ): Promise<MenuCacheEntry> {
    const base = `${keyPrefix}${channel}\u0000${options.location ?? ''}`;
    const key = at === undefined ? base : `${base}\u0000${at}`;
    const from = at === undefined ? store : timed;
    const cached = await readStore(from, key);
    if (cached && Date.now() - cached.checkedAt < revalidateMs) return cached;
    let pending = inflight.get(key);
    if (!pending) {
      if (at !== undefined) spendTimedRead();
      pending = revalidate(api, from, key, channel, at, cached).finally(() => inflight.delete(key));
      inflight.set(key, pending);
      // Settled either way: the platform only needs to know when it is done.
      try {
        options.waitUntil?.(pending.catch(() => undefined));
      } catch {
        // No background hook for this request: the visitors waiting keep it alive.
      }
    }
    return pending;
  }

  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const channel = readChannel(params, defaultChannel);
    if (channel === null) return errorResponse(INVALID_CHANNEL);
    const at = parseAt(params.get('at'), Date.now());
    if (at === null) return errorResponse(INVALID_AT);

    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }

    let entry: MenuCacheEntry;
    try {
      entry = await cachedMenu(api, channel, at);
    } catch (error) {
      return errorResponse(classify(error));
    }

    const etag = toEntityTag(entry.etag);
    const headers = { etag, 'cache-control': cacheControl };
    if (matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return Response.json({ data: entry.menu }, { headers });
  };
}

/**
 * The menu route: a Next App Router `GET` handler the browser reads the menu
 * through, so the workspace API key never leaves the server.
 *
 * ```ts
 * // app/api/ordering/menu/route.ts
 * export const revalidate = 60;
 * export const GET = createMenuRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * ```
 *
 * Built on Web `Request`/`Response` only — nothing from `next` is imported, so
 * it runs the same on Node, OpenNext on Workers or in a test.
 *
 * Two caches, both keyed by the ETag Medal sends with the menu:
 *
 * - SERVER: the last menu per channel (and location), revalidated with Medal
 *   at most every `revalidateSeconds` with `If-None-Match`. A 304 restarts the
 *   window and keeps the menu; requests that arrive while a revalidation is in
 *   flight share it. A read for a given `at` is a one-off and is not cached.
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
 * fails and a menu is cached, the cached menu is served instead
 * (stale-if-error) and Medal is asked again a window later.
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
 * this process. A store that throws is treated as a miss — the route still
 * answers from Medal.
 */
export interface MenuStore {
  get(key: string): MenuCacheEntry | undefined | Promise<MenuCacheEntry | undefined>;
  set(key: string, entry: MenuCacheEntry): void | Promise<void>;
}

export interface MenuRouteOptions {
  /**
   * The workspace API key (`process.env.MEDAL_API_KEY`). Read when the first
   * request arrives, not at import, so a build without it still succeeds; a
   * missing key answers `500 NOT_CONFIGURED`.
   */
  apiKey: string;
  /** The Medal API origin. Default: the SDK's (`https://io.medalsocial.com`). */
  baseUrl?: string;
  /** A ready client instead of one built from `apiKey`/`baseUrl` (tests, custom setups). */
  medal?: MenuClient;
  /** Server and CDN cache window. Default 60. Match the route's `export const revalidate`. */
  revalidateSeconds?: number;
  /** The channel when the request names none (and no table). Default `'takeaway'`. */
  defaultChannel?: OrderingChannel;
  /** The ordering location to read. Never taken from the request. */
  location?: string;
  /** Where the server keeps the menu. Default: in this process. */
  store?: MenuStore;
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
 * A Medal failure in the site's words. `ORDERING_NOT_ENABLED` is a 404, not a
 * 503: the workspace has no online ordering, so there is no menu here to
 * find, and a 503 would tell clients and CDNs to keep retrying something
 * that will not come back on its own.
 */
function classify(error: unknown): ErrorBody {
  if (error instanceof MedalApiError) {
    if (error.code === 'ORDERING_NOT_ENABLED') {
      return {
        status: 404,
        code: 'ORDERING_NOT_ENABLED',
        message: 'Online ordering is not enabled.',
      };
    }
    if (error.status === 400) {
      return { status: 400, code: 'INVALID_REQUEST', message: 'The menu request was not valid.' };
    }
    if (error.status === 429) {
      return {
        status: 503,
        code: 'MENU_UNAVAILABLE',
        message: 'The menu is not available right now.',
      };
    }
  }
  return { status: 502, code: 'MENU_UNAVAILABLE', message: 'The menu is not available right now.' };
}

function errorResponse({ status, code, message }: ErrorBody): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}

const DIGITS = /^\d{1,16}$/;
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** `?at=` as Medal takes it, `undefined` when absent, `null` when malformed. */
function parseAt(raw: string | null): string | undefined | null {
  if (raw === null) return undefined;
  const value = raw.trim();
  if (DIGITS.test(value)) return value;
  return ISO_WITH_ZONE.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * `?channel=` or `?c=` (in that order); a named channel that is not one of
 * the three is an error. With none, a `?t=` table link means dine-in, and
 * anything else gets the default.
 */
function readChannel(params: URLSearchParams, fallback: OrderingChannel): OrderingChannel | null {
  const named = params.get('channel') ?? params.get('c');
  if (named !== null) return parseChannel(named);
  return parseOrderLink(params).channel ?? fallback;
}

function memoryStore(): MenuStore {
  const entries = new Map<string, MenuCacheEntry>();
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => {
      entries.set(key, entry);
    },
  };
}

/** A Next App Router `GET` handler serving the menu as `{ data: OrderingMenu }`. */
export function createMenuRoute(
  options: MenuRouteOptions
): (request: Request) => Promise<Response> {
  const revalidateSeconds = options.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  const revalidateMs = revalidateSeconds * 1000;
  const cacheControl = `public, s-maxage=${revalidateSeconds}, stale-while-revalidate=${revalidateSeconds * STALE_WINDOWS}`;
  const defaultChannel = options.defaultChannel ?? 'takeaway';
  const store = options.store ?? memoryStore();
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

  async function readStore(key: string): Promise<MenuCacheEntry | undefined> {
    try {
      return await store.get(key);
    } catch {
      return undefined;
    }
  }

  async function writeStore(key: string, entry: MenuCacheEntry): Promise<void> {
    try {
      await store.set(key, entry);
    } catch {
      // A store that cannot write costs a Medal read next time, nothing more.
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

  async function revalidate(
    api: MenuClient,
    key: string,
    channel: OrderingChannel,
    cached: MenuCacheEntry | undefined
  ): Promise<MenuCacheEntry> {
    let entry: MenuCacheEntry;
    try {
      entry = await fetchEntry(api, channel, undefined, cached);
    } catch (error) {
      report(error);
      if (!cached) throw error;
      // Stale-if-error, and the next attempt waits a full window.
      entry = { ...cached, checkedAt: Date.now() };
    }
    await writeStore(key, entry);
    return entry;
  }

  async function cachedMenu(api: MenuClient, channel: OrderingChannel): Promise<MenuCacheEntry> {
    const key = `${channel}\u0000${options.location ?? ''}`;
    const cached = await readStore(key);
    if (cached && Date.now() - cached.checkedAt < revalidateMs) return cached;
    let pending = inflight.get(key);
    if (!pending) {
      pending = revalidate(api, key, channel, cached).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  }

  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const channel = readChannel(params, defaultChannel);
    if (channel === null) return errorResponse(INVALID_CHANNEL);
    const at = parseAt(params.get('at'));
    if (at === null) return errorResponse(INVALID_AT);

    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }

    let entry: MenuCacheEntry;
    try {
      entry =
        at === undefined
          ? await cachedMenu(api, channel)
          : await fetchEntry(api, channel, at, undefined).catch((error: unknown) => {
              report(error);
              throw error;
            });
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

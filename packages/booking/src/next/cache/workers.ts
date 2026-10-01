/**
 * `@medalsocial/booking/next/cache/workers` — the Cloudflare Workers Cache API.
 *
 * `caches.default`: per colo, a few milliseconds to read, no global purge —
 * changing the key is the purge. Use it for `cache.edge` on Workers (OpenNext).
 *
 * KEYS are `<origin><package key>`, so with the package's edge keys:
 * `<origin>/__medal-edge/booking-seed/v1/<env>[-<version>]/…`. On the site's
 * own origin because Cache API entries belong to the zone, and with the
 * deployed version in the path (from the `CF_VERSION_METADATA` binding unless
 * `version` is passed) so a deploy starts cold instead of reading entries an
 * older build wrote.
 *
 * `defer` hands work to the Worker's `ctx.waitUntil`, which keeps the isolate
 * alive for it after the response has gone; a floating promise on Workers is
 * cancelled when the response goes out.
 *
 * Off Workers (no `caches.default`, `next dev`, `next start`) and with no
 * origin configured, `key()` answers `null` and the package reads live, the
 * way it would with the `noop` adapter.
 */

import 'server-only';

import type { BookingCacheAdapter } from '../options';

/** The slice of the Worker context this adapter reads. */
export interface WorkerContext {
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  env?: Record<string, unknown>;
}

/** A value, or a function that reads it when it is needed. */
type Lazy<T> = T | (() => T);

export interface WorkersCacheAdapterOptions {
  /** The site's own origin (`https://example.com`). Without one nothing is cached. */
  origin: Lazy<string | undefined>;
  /** The deployed version for keys. Default: `env.CF_VERSION_METADATA.id`. */
  version?: Lazy<string | undefined>;
  /**
   * The Worker context for this request. Default: the one OpenNext publishes
   * on `globalThis` (what its `getCloudflareContext()` returns). Pass
   * `() => getCloudflareContext()` to be explicit.
   */
  context?: () => WorkerContext | undefined;
  /** The cache. Default `caches.default`. */
  cache?: () => Cache | undefined;
}

/** Where `@opennextjs/cloudflare` keeps the request's `{ env, ctx, cf }`. */
const OPENNEXT_CONTEXT = Symbol.for('__cloudflare-context__');

function defaultContext(): WorkerContext | undefined {
  return (globalThis as Record<symbol, WorkerContext | undefined>)[OPENNEXT_CONTEXT];
}

function defaultCache(): Cache | undefined {
  const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return storage?.default;
}

function read<T>(value: Lazy<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

export function workersCacheAdapter(options: WorkersCacheAdapterOptions): BookingCacheAdapter {
  const cacheOf = options.cache ?? defaultCache;

  function context(): WorkerContext | undefined {
    try {
      return (options.context ?? defaultContext)();
    } catch {
      // Not on Workers, or outside a request.
      return undefined;
    }
  }

  function originOf(): string | null {
    const origin = read(options.origin);
    if (!origin) return null;
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  /** The cache, or a refusal: every operation goes through here. */
  function cache(): Cache {
    const found = cacheOf();
    if (!found) throw new Error('The Workers Cache API is not available here');
    return found;
  }

  return {
    key(key) {
      if (!cacheOf()) return null;
      const origin = originOf();
      return origin === null ? null : `${origin}${key}`;
    },

    version() {
      if (options.version !== undefined) return read(options.version) || undefined;
      const metadata = context()?.env?.CF_VERSION_METADATA as { id?: unknown } | undefined;
      return typeof metadata?.id === 'string' && metadata.id !== '' ? metadata.id : undefined;
    },

    async get<T>(key: string) {
      const hit = await cache().match(key);
      return hit ? ((await hit.json()) as T) : undefined;
    },

    async put(key, value, ttlSeconds) {
      await cache().put(
        key,
        new Response(JSON.stringify(value), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttlSeconds}`,
          },
        })
      );
    },

    async delete(keys) {
      const found = cache();
      await Promise.all(keys.map((key) => found.delete(key)));
    },

    defer(work) {
      const ctx = context()?.ctx;
      if (typeof ctx?.waitUntil !== 'function') return false;
      ctx.waitUntil(work);
      return true;
    },
  };
}

/**
 * `@medalsocial/booking/next/cache/next-data` — Next's data cache.
 *
 * `unstable_cache` for the reads and `revalidateTag` for the expiry: the data
 * cache a Next deployment already has (on OpenNext, R2 plus the Durable Object
 * tag cache; on Vercel, its own). Use it for `cache.data`.
 *
 * READ-THROUGH ONLY. Next's data cache wraps a function; it has no `get` or
 * `put` by key and no per-key delete. So this adapter does everything through
 * `load` (keys are the key parts plus the call's arguments, exactly as
 * `unstable_cache` forms them) and `expireTag`; its `get` is always a miss and
 * `put`/`delete` do nothing. As `cache.edge` it would therefore cache nothing —
 * pair it with the `workers` or `memory` adapter there.
 */

import 'server-only';

import { revalidateTag, unstable_cache } from 'next/cache';
import { after } from 'next/server';
import type { BookingCacheAdapter } from '../options';

export function nextDataCacheAdapter(): BookingCacheAdapter {
  return {
    async get() {
      return undefined;
    },
    async put() {},
    async delete() {},

    load(keyParts, args, fill, options) {
      // One wrapper per call: the tags can name the call's own service, and
      // the callback's text is part of Next's key, so it is the same text for
      // every call.
      const loader = unstable_cache(async () => fill(), [...keyParts], {
        revalidate: options.ttlSeconds,
        tags: [...options.tags],
      });
      return (loader as (...callArgs: unknown[]) => Promise<Awaited<ReturnType<typeof fill>>>)(
        ...args
      );
    },

    /** Synchronous under the promise, so a throw reaches the caller's `try`. */
    expireTag(tag) {
      revalidateTag(tag, { expire: 0 });
      return Promise.resolve();
    },

    /** `after()`, inside a request; outside one there is nothing to hand to. */
    defer(work) {
      try {
        after(() => work);
        return true;
      } catch {
        return false;
      }
    },
  };
}

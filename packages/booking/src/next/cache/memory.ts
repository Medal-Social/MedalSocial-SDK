/**
 * `@medalsocial/booking/next/cache/memory` — a per-process LRU cache.
 *
 * For a site on Node (`next start`, Docker, a VM): one map in this process,
 * bounded by `maxEntries` (least recently used goes first) and by each
 * entry's TTL, with tag expiry for the data cache. Nothing is shared between
 * processes, so each instance warms on its own; the TTLs the package writes
 * (30 s to an hour) bound how far two instances can disagree.
 *
 * Values are stored as JSON and parsed on the way out, so a caller can never
 * mutate a cached entry through the object it was handed — the same
 * guarantee a real cache gives.
 */

import 'server-only';

import type { BookingCacheAdapter } from '../options';

export interface MemoryCacheAdapterOptions {
  /** Most entries held at once. Default 500. */
  maxEntries?: number;
  /** A ceiling on every entry's TTL, in seconds. Default: none. */
  maxTtlSeconds?: number;
  /** The clock, for tests. Default `Date.now`. */
  now?: () => number;
}

interface Entry {
  json: string;
  expiresAt: number;
  tags: readonly string[];
}

export function memoryCacheAdapter(options: MemoryCacheAdapterOptions = {}): BookingCacheAdapter {
  const maxEntries = Math.max(1, options.maxEntries ?? 500);
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function live(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    async get<T>(key: string) {
      const entry = live(key);
      if (entry === undefined) return undefined;
      // Most recently used moves to the end of the insertion order.
      entries.delete(key);
      entries.set(key, entry);
      return JSON.parse(entry.json) as T;
    },

    async put(key, value, ttlSeconds, putOptions) {
      const ttl = Math.min(ttlSeconds, options.maxTtlSeconds ?? ttlSeconds);
      if (!(ttl > 0)) return;
      const json = JSON.stringify(value);
      if (json === undefined) return;
      entries.delete(key);
      entries.set(key, { json, expiresAt: now() + ttl * 1000, tags: putOptions?.tags ?? [] });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },

    async delete(keys) {
      for (const key of keys) entries.delete(key);
    },

    async expireTag(tag) {
      for (const [key, entry] of entries) {
        if (entry.tags.includes(tag)) entries.delete(key);
      }
    },
  };
}

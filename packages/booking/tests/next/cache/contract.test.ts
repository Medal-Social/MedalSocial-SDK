import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ONE contract, four adapters (five subjects: the Workers adapter runs over a
 * fake Cache here and over workerd's real one in `workers.miniflare.test.ts`).
 *
 * What a booking site relies on, whichever cache backs it:
 *
 * - a miss is `undefined`, a hit is the JSON value it was given, and nobody
 *   can change a cached entry through the object they were handed;
 * - `delete` drops exactly the named keys;
 * - an entry is gone after its TTL;
 * - `cacheLoad` reads through: one fill, then hits;
 * - `expireTag` drops what was stored under the tag;
 * - `defer` hands work to the platform, or says it cannot so the caller
 *   awaits it.
 *
 * Not every cache can do every part — Next's data cache is read-through only,
 * the noop cache holds nothing, the Cache API has no tags — so each subject
 * declares what it can, and the parts it cannot are asserted to be the safe
 * fallback (a miss, a no-op), never skipped silently.
 */

/** Next's data cache, standing in: `unstable_cache` and `revalidateTag` over a map. */
const nextCache = vi.hoisted(() => {
  const entries = new Map<string, { value: unknown; expiresAt: number; tags: string[] }>();
  const clock = { now: 0 };
  return {
    entries,
    clock,
    unstable_cache: vi.fn(
      (
        fn: (...args: unknown[]) => Promise<unknown>,
        keyParts: string[],
        options: { revalidate: number; tags: string[] }
      ) =>
        async (...args: unknown[]) => {
          const key = `${keyParts.join(',')}-${JSON.stringify(args)}`;
          const hit = entries.get(key);
          if (hit && hit.expiresAt > clock.now) return structuredClone(hit.value);
          const value = await fn(...args);
          entries.set(key, {
            value: structuredClone(value),
            expiresAt: clock.now + options.revalidate * 1000,
            tags: options.tags,
          });
          return value;
        }
    ),
    revalidateTag: vi.fn((tag: string) => {
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
    }),
  };
});
vi.mock('next/cache', () => ({
  unstable_cache: nextCache.unstable_cache,
  revalidateTag: nextCache.revalidateTag,
}));

const nextServer = vi.hoisted(() => ({ inRequest: true, after: vi.fn() }));
vi.mock('next/server', () => ({
  after: (work: () => unknown) => {
    if (!nextServer.inRequest) throw new Error('after() outside a request scope');
    nextServer.after(work);
  },
}));

import { memoryCacheAdapter } from '../../../src/next/cache/memory';
import { nextDataCacheAdapter } from '../../../src/next/cache/next-data';
import { noopCacheAdapter } from '../../../src/next/cache/noop';
import { type WorkerContext, workersCacheAdapter } from '../../../src/next/cache/workers';
import { type BookingCacheAdapter, cacheLoad, inBackground } from '../../../src/next/options';
import { createFakeColoCache, type FakeColoCache } from '../../support/colo-cache';

interface Subject {
  name: string;
  make(): {
    adapter: BookingCacheAdapter;
    /** Move the adapter's clock on (`real` subjects wait instead). */
    advance(ms: number): Promise<void>;
    /** The platform's background hook, when the subject has one. */
    waitUntil?: ReturnType<typeof vi.fn>;
    /** Take the platform's background hook away for this request. */
    leaveRequest?(): void;
  };
  /** `get` / `put` / `delete` hold values. */
  stores: boolean;
  /** `cacheLoad` caches between calls. */
  readsThrough: boolean;
  /** `expireTag` exists and drops tagged entries. */
  tags: boolean;
  /** `defer` exists. */
  defers: boolean;
}

let colo: FakeColoCache;
let memoryNow = 0;

const SUBJECTS: Subject[] = [
  {
    name: 'memory',
    make: () => ({
      adapter: memoryCacheAdapter({ now: () => memoryNow }),
      advance: async (ms) => {
        memoryNow += ms;
      },
    }),
    stores: true,
    readsThrough: true,
    tags: true,
    defers: false,
  },
  {
    name: 'noop',
    make: () => ({ adapter: noopCacheAdapter(), advance: async () => {} }),
    stores: false,
    readsThrough: false,
    tags: false,
    defers: false,
  },
  {
    name: 'next-data',
    make: () => ({
      adapter: nextDataCacheAdapter(),
      advance: async (ms) => {
        nextCache.clock.now += ms;
      },
      waitUntil: nextServer.after,
      leaveRequest: () => {
        nextServer.inRequest = false;
      },
    }),
    stores: false,
    readsThrough: true,
    tags: true,
    defers: true,
  },
  {
    name: 'workers (fake Cache API)',
    make: () => {
      const context: { current: WorkerContext | undefined } = {
        current: { ctx: { waitUntil: vi.fn() }, env: {} },
      };
      const waitUntil = context.current?.ctx?.waitUntil as ReturnType<typeof vi.fn>;
      return {
        adapter: workersCacheAdapter({
          origin: 'https://salong.example',
          cache: () => colo.cache,
          context: () => context.current,
        }),
        // The fake keeps entries; Cache-Control is what retires them for real
        // (asserted below and against workerd in the Miniflare suite).
        advance: async () => {
          colo.entries.clear();
        },
        waitUntil,
        leaveRequest: () => {
          context.current = undefined;
        },
      };
    },
    stores: true,
    readsThrough: true,
    tags: false,
    defers: true,
  },
];

beforeEach(() => {
  colo = createFakeColoCache();
  memoryNow = 1_000_000;
  nextCache.entries.clear();
  nextCache.clock.now = 0;
  nextCache.unstable_cache.mockClear();
  nextCache.revalidateTag.mockClear();
  nextServer.inRequest = true;
  nextServer.after.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The storage key for a package key (`adapter.key`), or the key itself. */
function storageKey(adapter: BookingCacheAdapter, key: string): string {
  const mapped = adapter.key ? adapter.key(key) : key;
  return mapped ?? key;
}

describe.each(SUBJECTS)('the cache adapter contract: $name', (subject) => {
  it('misses on an empty cache', async () => {
    const { adapter } = subject.make();
    expect(await adapter.get(storageKey(adapter, '/k'))).toBeUndefined();
  });

  it('returns the JSON value it was given — a copy, not the stored object', async () => {
    const { adapter } = subject.make();
    const key = storageKey(adapter, '/seed/one');
    const value = { services: [{ id: 'svc-1', name: 'Klipp' }], generatedAt: 1 };
    await adapter.put(key, value, 60);
    const hit = await adapter.get<typeof value>(key);
    if (!subject.stores) {
      expect(hit).toBeUndefined();
      return;
    }
    expect(hit).toEqual(value);
    (hit as typeof value).services.push({ id: 'svc-2', name: 'Farge' });
    value.services.length = 0;
    expect(await adapter.get(key)).toEqual({
      services: [{ id: 'svc-1', name: 'Klipp' }],
      generatedAt: 1,
    });
  });

  it('drops exactly the keys it is told to delete', async () => {
    const { adapter } = subject.make();
    const [a, b, c] = ['/a', '/b', '/c'].map((key) => storageKey(adapter, key));
    await Promise.all([a, b, c].map((key) => adapter.put(key, key, 60)));
    await adapter.delete([a, c]);
    expect(await adapter.get(a)).toBeUndefined();
    expect(await adapter.get(c)).toBeUndefined();
    expect(await adapter.get(b)).toBe(subject.stores ? b : undefined);
    await expect(adapter.delete([])).resolves.toBeUndefined();
  });

  it('is a miss once the TTL has passed', async () => {
    const { adapter, advance } = subject.make();
    const key = storageKey(adapter, '/short');
    await adapter.put(key, 'x', 30);
    await advance(29_000);
    if (subject.name === 'memory') expect(await adapter.get(key)).toBe('x');
    await advance(2_000);
    expect(await adapter.get(key)).toBeUndefined();
  });

  it('reads through: one fill, then hits until the TTL runs out', async () => {
    const { adapter, advance } = subject.make();
    const fill = vi.fn(async () => ({ at: fill.mock.calls.length }));
    const options = { ttlSeconds: 30, tags: ['booking-catalogue'] };
    const first = await cacheLoad(adapter, ['demo-booking', 'services'], [7], fill, options);
    const second = await cacheLoad(adapter, ['demo-booking', 'services'], [7], fill, options);
    expect(first).toEqual({ at: 1 });
    expect(second).toEqual(subject.readsThrough ? { at: 1 } : { at: 2 });
    // Different arguments, a different entry.
    await cacheLoad(adapter, ['demo-booking', 'services'], [8], fill, options);
    expect(fill).toHaveBeenCalledTimes(subject.readsThrough ? 2 : 3);
    await advance(31_000);
    await cacheLoad(adapter, ['demo-booking', 'services'], [7], fill, options);
    expect(fill).toHaveBeenCalledTimes(subject.readsThrough ? 3 : 4);
  });

  it('never caches a failed fill', async () => {
    const { adapter } = subject.make();
    const fill = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Medal is down'))
      .mockResolvedValue('ok');
    const options = { ttlSeconds: 30, tags: [] };
    await expect(cacheLoad(adapter, ['p', 'r'], [], fill, options)).rejects.toThrow('Medal');
    await expect(cacheLoad(adapter, ['p', 'r'], [], fill, options)).resolves.toBe('ok');
  });

  it('expires by tag where it keeps tags, and is a safe no-op where it does not', async () => {
    const { adapter } = subject.make();
    const fill = vi.fn(async () => 'slots');
    const tagged = { ttlSeconds: 30, tags: ['booking-slots:svc-1'] };
    const other = { ttlSeconds: 30, tags: ['booking-slots:svc-2'] };
    await cacheLoad(adapter, ['p', 'availability'], ['svc-1'], fill, tagged);
    await cacheLoad(adapter, ['p', 'availability'], ['svc-2'], fill, other);
    const before = fill.mock.calls.length;
    if (adapter.expireTag) await adapter.expireTag('booking-slots:svc-1');
    expect(adapter.expireTag !== undefined).toBe(subject.tags || subject.name === 'noop');
    await cacheLoad(adapter, ['p', 'availability'], ['svc-1'], fill, tagged);
    await cacheLoad(adapter, ['p', 'availability'], ['svc-2'], fill, other);
    if (subject.tags) {
      // svc-1 refilled; svc-2 still a hit.
      expect(fill).toHaveBeenCalledTimes(before + 1);
    } else if (subject.readsThrough) {
      expect(fill).toHaveBeenCalledTimes(before);
    } else {
      expect(fill).toHaveBeenCalledTimes(before + 2);
    }
  });

  it('defers to the platform inside a request, and says so when it cannot', async () => {
    const made = subject.make();
    const work = Promise.resolve('done');
    if (!subject.defers) {
      expect(made.adapter.defer).toBeUndefined();
      // The caller awaits instead.
      let ran = false;
      await inBackground(
        made.adapter,
        work.then(() => {
          ran = true;
        })
      );
      expect(ran).toBe(true);
      return;
    }
    expect(made.adapter.defer?.(work)).toBe(true);
    expect(made.waitUntil).toHaveBeenCalledTimes(1);
    made.leaveRequest?.();
    expect(made.adapter.defer?.(work)).toBe(false);
  });

  it('treats a throwing store as a miss when reading through', async () => {
    const { adapter } = subject.make();
    if (!subject.stores) return expect(adapter.key?.('/x') ?? null).toBeNull();
    vi.spyOn(adapter, 'get').mockRejectedValue(new Error('cache down'));
    vi.spyOn(adapter, 'put').mockRejectedValue(new Error('cache down'));
    const fill = vi.fn(async () => 'live');
    await expect(
      cacheLoad(adapter, ['p', 'r'], [], fill, { ttlSeconds: 5, tags: [] })
    ).resolves.toBe('live');
  });
});

describe('the noop adapter', () => {
  it('can store nothing, so the seed takes its bypass path', () => {
    expect(noopCacheAdapter().key?.('/anything')).toBeNull();
  });

  it('still reads through, live, every time', async () => {
    const fill = vi.fn(async () => 1);
    await cacheLoad(noopCacheAdapter(), ['p'], [], fill, { ttlSeconds: 60, tags: [] });
    await cacheLoad(noopCacheAdapter(), ['p'], [], fill, { ttlSeconds: 60, tags: [] });
    expect(fill).toHaveBeenCalledTimes(2);
  });
});

describe('the memory adapter', () => {
  it('evicts the least recently used entry past maxEntries', async () => {
    const adapter = memoryCacheAdapter({ maxEntries: 2, now: () => memoryNow });
    await adapter.put('a', 1, 60);
    await adapter.put('b', 2, 60);
    // Reading `a` makes `b` the least recently used.
    expect(await adapter.get('a')).toBe(1);
    await adapter.put('c', 3, 60);
    expect(await adapter.get('b')).toBeUndefined();
    expect(await adapter.get('a')).toBe(1);
    expect(await adapter.get('c')).toBe(3);
  });

  it('caps a TTL at maxTtlSeconds and refuses a non-positive one', async () => {
    const adapter = memoryCacheAdapter({ maxTtlSeconds: 10, now: () => memoryNow });
    await adapter.put('long', 'x', 3600);
    await adapter.put('none', 'y', 0);
    expect(await adapter.get('none')).toBeUndefined();
    memoryNow += 11_000;
    expect(await adapter.get('long')).toBeUndefined();
  });

  it('stores nothing for a value JSON cannot hold', async () => {
    const adapter = memoryCacheAdapter();
    await adapter.put('fn', undefined, 60);
    expect(await adapter.get('fn')).toBeUndefined();
  });

  it('keeps at least one entry and uses the real clock by default', async () => {
    const adapter = memoryCacheAdapter({ maxEntries: 0 });
    await adapter.put('only', 'x', 60);
    expect(await adapter.get('only')).toBe('x');
  });
});

describe('the next-data adapter', () => {
  it('keys exactly as unstable_cache does: the key parts, then the call arguments', async () => {
    const adapter = nextDataCacheAdapter();
    await cacheLoad(adapter, ['demo-booking', 'schedule'], ['svc-1', 1, 2, 3], async () => [], {
      ttlSeconds: 300,
      tags: ['booking-catalogue'],
    });
    expect(nextCache.unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      ['demo-booking', 'schedule'],
      { revalidate: 300, tags: ['booking-catalogue'] }
    );
    expect([...nextCache.entries.keys()]).toEqual(['demo-booking,schedule-["svc-1",1,2,3]']);
  });

  it('expires a tag at once (expire: 0), synchronously under the promise', async () => {
    const adapter = nextDataCacheAdapter();
    nextCache.revalidateTag.mockImplementationOnce(() => {
      throw new Error('outside a request');
    });
    expect(() => adapter.expireTag?.('booking-slots:svc-1')).toThrow('outside a request');
    await adapter.expireTag?.('booking-slots:svc-1');
    expect(nextCache.revalidateTag).toHaveBeenLastCalledWith('booking-slots:svc-1', { expire: 0 });
  });

  it('hands deferred work to after(), which runs it', async () => {
    const adapter = nextDataCacheAdapter();
    const work = Promise.resolve('x');
    adapter.defer?.(work);
    const [scheduled] = nextServer.after.mock.calls[0] as [() => unknown];
    await expect(scheduled()).resolves.toBe('x');
  });
});

describe('the workers adapter', () => {
  const context = () => ({ ctx: { waitUntil: vi.fn() }, env: {} });

  it('keys on the site origin, whatever path the origin was given with', () => {
    const adapter = workersCacheAdapter({
      origin: 'https://Salong.Example:443/some/page',
      cache: () => colo.cache,
      context,
    });
    expect(adapter.key?.('/__medal-edge/booking-seed/v1/prod/catalogue/1')).toBe(
      'https://salong.example/__medal-edge/booking-seed/v1/prod/catalogue/1'
    );
  });

  it('stores nothing without an origin, with an unreadable one, or off Workers', () => {
    const at = (
      origin: string | undefined | (() => string | undefined),
      cache?: () => Cache | undefined
    ) => workersCacheAdapter({ origin, cache, context }).key?.('/k');
    expect(at(undefined, () => colo.cache)).toBeNull();
    expect(at('not a url', () => colo.cache)).toBeNull();
    expect(
      at(
        () => undefined,
        () => colo.cache
      )
    ).toBeNull();
    expect(at('https://salong.example', () => undefined)).toBeNull();
  });

  it('writes JSON with the TTL as Cache-Control, which is what retires it', async () => {
    const adapter = workersCacheAdapter({
      origin: 'https://salong.example',
      cache: () => colo.cache,
      context,
    });
    await adapter.put('https://salong.example/k', { a: 1 }, 30);
    expect(colo.entries.get('https://salong.example/k')).toMatchObject({
      body: '{"a":1}',
      cacheControl: 'public, max-age=30',
    });
    expect(colo.entries.get('https://salong.example/k')?.headers).toContainEqual([
      'content-type',
      'application/json',
    ]);
  });

  it('refuses to read or write where there is no Cache API', async () => {
    const adapter = workersCacheAdapter({
      origin: 'https://salong.example',
      cache: () => undefined,
    });
    await expect(adapter.get('https://salong.example/k')).rejects.toThrow('Cache API');
    await expect(adapter.put('https://salong.example/k', 1, 1)).rejects.toThrow('Cache API');
    await expect(adapter.delete(['https://salong.example/k'])).rejects.toThrow('Cache API');
  });

  it('reads the deployed version from CF_VERSION_METADATA, or takes one passed in', () => {
    const on = (env: Record<string, unknown>) =>
      workersCacheAdapter({
        origin: 'https://salong.example',
        context: () => ({ env }),
      }).version?.();
    expect(on({ CF_VERSION_METADATA: { id: 'v-42' } })).toBe('v-42');
    expect(on({ CF_VERSION_METADATA: { id: '' } })).toBeUndefined();
    expect(on({})).toBeUndefined();
    expect(
      workersCacheAdapter({ origin: 'https://salong.example', version: 'pinned' }).version?.()
    ).toBe('pinned');
    expect(
      workersCacheAdapter({ origin: 'https://salong.example', version: () => '' }).version?.()
    ).toBeUndefined();
    // A context that throws (off Workers) is no version, not an error.
    expect(
      workersCacheAdapter({
        origin: 'https://salong.example',
        context: () => {
          throw new Error('not on Workers');
        },
      }).version?.()
    ).toBeUndefined();
  });

  it('finds OpenNext’s published context and caches.default when given neither', async () => {
    const symbol = Symbol.for('__cloudflare-context__');
    const waitUntil = vi.fn();
    const globals = globalThis as Record<string | symbol, unknown>;
    const previous = { context: globals[symbol], caches: globals.caches };
    globals[symbol] = { ctx: { waitUntil }, env: { CF_VERSION_METADATA: { id: 'v-7' } } };
    globals.caches = { default: colo.cache };
    try {
      const adapter = workersCacheAdapter({ origin: 'https://salong.example' });
      expect(adapter.key?.('/k')).toBe('https://salong.example/k');
      expect(adapter.version?.()).toBe('v-7');
      expect(adapter.defer?.(Promise.resolve())).toBe(true);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await adapter.put('https://salong.example/k', 1, 5);
      expect(await adapter.get('https://salong.example/k')).toBe(1);
    } finally {
      globals[symbol] = previous.context;
      globals.caches = previous.caches;
    }
  });

  it('is off Workers when nothing is published', () => {
    const globals = globalThis as Record<string, unknown>;
    const previous = globals.caches;
    globals.caches = undefined;
    try {
      const adapter = workersCacheAdapter({ origin: 'https://salong.example' });
      expect(adapter.key?.('/k')).toBeNull();
      expect(adapter.defer?.(Promise.resolve())).toBe(false);
    } finally {
      globals.caches = previous;
    }
  });
});

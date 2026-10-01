import { vi } from 'vitest';

/**
 * A stand-in for the Workers Cache API (`caches.default`): an in-memory map
 * that keeps what was put, with the `Cache-Control` it was put with, so a test
 * can assert both the key and the TTL. `match` hands back a fresh Response
 * each time, as the real one does.
 */
export interface FakeColoCache {
  cache: Cache;
  entries: Map<string, { body: string; cacheControl: string | null; headers?: [string, string][] }>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function keyOf(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.toString();
  return request.url;
}

export function createFakeColoCache(): FakeColoCache {
  const entries = new Map<
    string,
    { body: string; cacheControl: string | null; headers?: [string, string][] }
  >();
  const match = vi.fn(async (request: RequestInfo | URL) => {
    const entry = entries.get(keyOf(request));
    return entry
      ? new Response(entry.body, {
          // Every header it was put with, as the real Cache API keeps them.
          headers:
            entry.headers ?? (entry.cacheControl ? { 'Cache-Control': entry.cacheControl } : {}),
        })
      : undefined;
  });
  const put = vi.fn(async (request: RequestInfo | URL, response: Response) => {
    entries.set(keyOf(request), {
      body: await response.text(),
      cacheControl: response.headers.get('Cache-Control'),
      headers: [...response.headers.entries()],
    });
  });
  const remove = vi.fn(async (request: RequestInfo | URL) => entries.delete(keyOf(request)));
  const cache = { match, put, delete: remove } as unknown as Cache;
  return { cache, entries, match, put, delete: remove };
}

/** Installs `fake` as `globalThis.caches.default`; returns the undo. */
export function installColoCache(fake: FakeColoCache): () => void {
  const previous = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: fake.cache };
  return () => {
    (globalThis as { caches?: unknown }).caches = previous;
  };
}

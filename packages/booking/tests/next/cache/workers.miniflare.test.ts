import { Miniflare, Response as WorkerdResponse } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { workersCacheAdapter } from '../../../src/next/cache/workers';
import { cacheLoad } from '../../../src/next/options';

/**
 * The Workers adapter against workerd's own Cache API (Miniflare), not a map:
 * the key rules, the JSON round trip, `delete`, and — the part a fake cannot
 * prove — that the `Cache-Control: max-age` the adapter writes really retires
 * the entry.
 *
 * Miniflare's `caches` live in workerd, so a `Response` crossing into it has
 * to be workerd's class; the bridge below rebuilds each one. Everything the
 * adapter decides (keys, headers, bodies, what a miss is) is the adapter's.
 */

let mf: Miniflare;
let cache: Cache;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
  });
  const workerd = ((await mf.getCaches()) as unknown as { default: Cache }).default;
  cache = {
    match: async (key: string) => {
      const hit = await workerd.match(key);
      return hit
        ? new Response(await hit.text(), { headers: [...hit.headers.entries()] })
        : undefined;
    },
    put: async (key: string, response: Response) =>
      workerd.put(
        key,
        new WorkerdResponse(await response.text(), {
          headers: [...response.headers.entries()],
        }) as unknown as Response
      ),
    delete: (key: string) => workerd.delete(key),
  } as unknown as Cache;
}, 30_000);

afterAll(async () => {
  await mf?.dispose();
});

function adapter() {
  return workersCacheAdapter({
    origin: 'https://salong.example',
    cache: () => cache,
    context: () => ({ ctx: { waitUntil: vi.fn() }, env: { CF_VERSION_METADATA: { id: 'v-1' } } }),
  });
}

describe('workersCacheAdapter on workerd (Miniflare)', () => {
  it('misses, stores JSON, and deletes on the real Cache API', async () => {
    const edge = adapter();
    const key = edge.key?.('/__medal-edge/booking-seed/v1/test-v-1/catalogue/1') as string;
    expect(key).toBe('https://salong.example/__medal-edge/booking-seed/v1/test-v-1/catalogue/1');
    expect(await edge.get(key)).toBeUndefined();
    await edge.put(key, { services: [{ id: 'svc-1' }], resources: null }, 60);
    expect(await edge.get(key)).toEqual({ services: [{ id: 'svc-1' }], resources: null });
    await edge.delete([key]);
    expect(await edge.get(key)).toBeUndefined();
  });

  it('is retired by the max-age it wrote', async () => {
    const edge = adapter();
    const key = edge.key?.('/__medal-edge/booking-seed/v1/test/gen/svc-1') as string;
    await edge.put(key, 1_234, 1);
    expect(await edge.get(key)).toBe(1_234);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(await edge.get(key)).toBeUndefined();
  }, 10_000);

  it('reads through: one fill, then a hit', async () => {
    const edge = adapter();
    const fill = vi.fn(async () => ['slot']);
    const options = { ttlSeconds: 30, tags: [] };
    await cacheLoad(edge, ['demo-booking', 'availability'], ['svc-1', 1, 2], fill, options);
    await cacheLoad(edge, ['demo-booking', 'availability'], ['svc-1', 1, 2], fill, options);
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('reports the deployed version and defers to waitUntil', () => {
    const edge = adapter();
    expect(edge.version?.()).toBe('v-1');
    expect(edge.defer?.(Promise.resolve())).toBe(true);
  });
});

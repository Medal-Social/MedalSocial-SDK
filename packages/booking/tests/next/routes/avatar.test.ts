import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The avatar proxy. Medal hands out presigned R2 URLs that are re-signed on
 * every read, so the browser never caches a stylist photo; this route gives
 * each stylist one stable, cacheable URL on this site instead.
 */

import { avatarRoute } from '../../../src/next/routes/catalogue-routes';
import { testRuntime } from '../../support/next-runtime';

const cachedResources = vi.fn();
const rt = testRuntime({ catalogue: { cachedResources } as never });

const GET = async (request: Request, context: { params: Promise<{ resourceId: string }> }) =>
  avatarRoute(rt, request, (await context.params).resourceId);

const PHOTO =
  'https://acct.r2.cloudflarestorage.com/bucket/stylists/sara.png?X-Amz-Date=20260929T120000Z&X-Amz-Signature=abc';
const RESIGNED =
  'https://acct.r2.cloudflarestorage.com/bucket/stylists/sara.png?X-Amz-Date=20260929T130000Z&X-Amz-Signature=def';

const SARA = {
  id: 'res_sara-1',
  name: 'Sara',
  photo_url: PHOTO,
  bio: null,
  service_ids: [],
  sort_order: 1,
};
const NADIA = { ...SARA, id: 'res-nadia', name: 'Nadia', photo_url: null };

function call(resourceId: string, headers: Record<string, string> = {}) {
  return GET(new Request(`https://salong.example/api/booking/avatar/${resourceId}`, { headers }), {
    params: Promise.resolve({ resourceId }),
  });
}

const upstream = vi.fn();

beforeEach(() => {
  cachedResources.mockResolvedValue([SARA, NADIA]);
  upstream.mockImplementation(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
  );
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GET /api/booking/avatar/[resourceId]', () => {
  it('streams the photo with a day of browser cache and a stable ETag', async () => {
    const response = await call(SARA.id);

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(PHOTO, expect.anything());
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(response.headers.get('ETag')).toMatch(/^"[0-9a-f]+"$/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('keeps the same ETag when Medal re-signs the same object', async () => {
    const first = (await call(SARA.id)).headers.get('ETag');
    cachedResources.mockResolvedValue([{ ...SARA, photo_url: RESIGNED }]);
    const second = (await call(SARA.id)).headers.get('ETag');

    expect(second).toBe(first);

    cachedResources.mockResolvedValue([
      {
        ...SARA,
        photo_url:
          'https://acct.r2.cloudflarestorage.com/bucket/stylists/sara-new.png?X-Amz-Date=1',
      },
    ]);
    expect((await call(SARA.id)).headers.get('ETag')).not.toBe(first);
  });

  it('answers 304 without fetching when the browser already holds it', async () => {
    const etag = (await call(SARA.id)).headers.get('ETag') ?? '';
    upstream.mockClear();

    const response = await call(SARA.id, { 'If-None-Match': etag });

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(etag);
    expect(response.headers.get('Cache-Control')).toContain('max-age=86400');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('is 404 for a stylist it does not know, or one with no photo', async () => {
    expect((await call('res-unknown')).status).toBe(404);
    expect((await call(NADIA.id)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ['a path', '..%2Fsecret'],
    ['a dot', 'res.sara'],
    ['too long', 'a'.repeat(65)],
    ['empty', ''],
  ])('refuses an id that is %s with 400, before any lookup', async (_label, id) => {
    const response = await call(id);
    expect(response.status).toBe(400);
    expect(cachedResources).not.toHaveBeenCalled();
  });

  it('refuses to relay anything that is not an image', async () => {
    upstream.mockResolvedValue(
      new Response('<script>alert(1)</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const response = await call(SARA.id);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is 502, uncached, when the photo host fails', async () => {
    upstream.mockResolvedValue(new Response('nope', { status: 403 }));

    const response = await call(SARA.id);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives the photo host five seconds, then answers 502 uncached', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    upstream.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    const response = await call(SARA.id);

    expect(timeout).toHaveBeenCalledWith(5000);
    expect(upstream).toHaveBeenCalledWith(
      PHOTO,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    timeout.mockRestore();
  });

  it('relays a catalogue failure the way the other read routes do', async () => {
    cachedResources.mockRejectedValue(new Error('down'));

    const response = await call(SARA.id);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

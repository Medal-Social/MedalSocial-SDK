import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pre-release review of the avatar proxy (SSRF and active content). The route
 * fetches a URL Medal hands it on behalf of an unauthenticated visitor, so it
 * fetches only from hosts the site allows (`options.avatarHosts`, default
 * Medal's photo storage and Google profile pictures), never an internal
 * address, never through a redirect; and it relays only raster images, with
 * headers that keep a body opened as a document inert.
 */

import { DEFAULT_AVATAR_HOSTS } from '../../../src/next/options';
import { avatarRoute } from '../../../src/next/routes/catalogue-routes';
import { testLogger, testRuntime } from '../../support/next-runtime';

const cachedResources = vi.fn();
const upstream = vi.fn();

const STYLIST = {
  id: 'r1',
  name: 'Sara',
  photo_url: null as string | null,
  bio: null,
  service_ids: [],
  sort_order: 1,
};

function runtime(avatarHosts?: readonly string[]) {
  const logger = testLogger();
  const rt = testRuntime(
    { catalogue: { cachedResources } as never, logger },
    avatarHosts ? { avatarHosts } : {}
  );
  return { rt, logger };
}

const call = (rt: ReturnType<typeof runtime>['rt']) =>
  avatarRoute(rt, new Request('https://salong.example/api/booking/avatar/r1'), 'r1');

function photo(photo_url: string) {
  cachedResources.mockResolvedValue([{ ...STYLIST, photo_url }]);
}

function answer(contentType: string | null, status = 200) {
  upstream.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status,
      headers: contentType === null ? {} : { 'Content-Type': contentType },
    })
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', upstream);
  answer('image/png');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('avatarRoute — which hosts it fetches from', () => {
  it('defaults to Medal’s photo storage and Google profile pictures', () => {
    expect(DEFAULT_AVATAR_HOSTS).toEqual(['*.r2.cloudflarestorage.com', '*.googleusercontent.com']);
    expect(Object.isFrozen(DEFAULT_AVATAR_HOSTS)).toBe(true);
  });

  it.each([
    'https://acct.r2.cloudflarestorage.com/bucket/sara.png?X-Amz-Signature=x',
    'https://bucket.acct.r2.cloudflarestorage.com/sara.png',
    'https://lh3.googleusercontent.com/a/abc=s96-c',
  ])('fetches %s by default, without following a redirect', async (url) => {
    const { rt } = runtime();
    photo(url);

    const response = await call(rt);

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }));
  });

  it.each([
    ['an unlisted host', 'https://evil.example/sara.png'],
    ['the apex of a wildcard', 'https://r2.cloudflarestorage.com/sara.png'],
    ['a look-alike suffix', 'https://acct.r2.cloudflarestorage.com.evil.example/sara.png'],
    ['a trailing-dot host', 'https://acct.r2.cloudflarestorage.com./sara.png'],
    ['loopback by IPv4', 'https://127.0.0.1/sara.png'],
    ['loopback spelled as a number', 'https://2130706433/sara.png'],
    ['a private IPv4 address', 'https://10.0.0.5/sara.png'],
    ['the metadata address', 'https://169.254.169.254/latest/meta-data'],
    ['an IPv6 literal', 'https://[::1]/sara.png'],
    ['localhost', 'https://localhost/sara.png'],
    ['a non-default port', 'https://acct.r2.cloudflarestorage.com:8443/sara.png'],
    ['credentials in the URL', 'https://user:pw@acct.r2.cloudflarestorage.com/sara.png'],
    ['plain http', 'http://acct.r2.cloudflarestorage.com/sara.png'],
    ['a relative path', '/api/media/photo.png'],
  ])('refuses %s with an uncached 404, fetching nothing', async (_label, url) => {
    const { rt, logger } = runtime();
    photo(url);

    const response = await call(rt);

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { resourceId: 'r1' },
      'Stylist photo is on a host this site does not allow'
    );
  });

  it('takes the site’s own list instead of the default, exact names and `*.` suffixes', async () => {
    const { rt } = runtime(['Photos.Example.com', '*.cdn.example.net']);

    for (const url of ['https://photos.example.com/a.png', 'https://eu.cdn.example.net/a.png']) {
      photo(url);
      expect((await call(rt)).status).toBe(200);
    }
    for (const url of [
      'https://acct.r2.cloudflarestorage.com/a.png',
      'https://cdn.example.net/a.png',
      'https://other.example.com/a.png',
    ]) {
      photo(url);
      expect((await call(rt)).status).toBe(404);
    }
  });

  it.each([
    ['a bare wildcard', ['*']],
    ['a wildcard over a whole TLD', ['*.com']],
    ['an empty entry', ['']],
    ['an IP address, even when listed', ['127.0.0.1']],
    ['an internal name, even when listed', ['*.internal', 'metadata.google.internal']],
    ['a single-label name, even when listed', ['intranet-host']],
  ])('never matches %s', async (_label, hosts) => {
    const { rt } = runtime(hosts);
    for (const url of [
      'https://example.com/a.png',
      'https://127.0.0.1/a.png',
      'https://metadata.google.internal/a.png',
      'https://svc.internal/a.png',
      'https://intranet-host/a.png',
    ]) {
      photo(url);
      expect((await call(rt)).status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers a redirect from the photo host with an uncached 502, not its target', async () => {
    const { rt } = runtime();
    photo('https://acct.r2.cloudflarestorage.com/sara.png');
    upstream.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://10.0.0.5/' } })
    );

    const response = await call(rt);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('avatarRoute — what it relays', () => {
  beforeEach(() => photo('https://acct.r2.cloudflarestorage.com/sara.png'));

  it.each([
    ['image/jpeg', 'image/jpeg'],
    ['image/png', 'image/png'],
    ['image/webp', 'image/webp'],
    ['image/avif', 'image/avif'],
    ['image/gif', 'image/gif'],
    ['IMAGE/JPEG', 'image/jpeg'],
    ['image/png; charset=binary', 'image/png'],
  ])('relays %s as %s, inert', async (sent, served) => {
    const { rt } = runtime();
    answer(sent);

    const response = await call(rt);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(served);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  });

  it.each([
    'image/svg+xml',
    'image/SVG+XML',
    'Image/Svg+Xml; charset=utf-8',
    'text/html',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'application/octet-stream',
    'image/x-icon',
    'image/',
    '',
  ])('refuses %j with an uncached 502 and cancels the body', async (sent) => {
    const { rt, logger } = runtime();
    answer(sent);

    const response = await call(rt);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(logger.warn).toHaveBeenCalledWith(
      { resourceId: 'r1', contentType: sent },
      'Stylist photo is not a raster image'
    );
  });
});

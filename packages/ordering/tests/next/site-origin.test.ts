import { describe, expect, it } from 'vitest';
import { postGuard, type SiteOriginOptions } from '../../src/next/shared';

const CROSS = { status: 403, code: 'INVALID_REQUEST', message: 'cross' } as const;
const NOT_JSON = { status: 415, code: 'INVALID_REQUEST', message: 'json' } as const;

function guard(
  url: string,
  headers: Record<string, string>,
  options?: SiteOriginOptions
): number | null {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
  });
  return (
    postGuard(request, { crossOrigin: CROSS as never, notJson: NOT_JSON as never }, options)
      ?.status ?? null
  );
}

describe('postGuard — the site origin', () => {
  it('passes a request without an Origin, and checks the content type', () => {
    expect(guard('https://shop.test/api', {})).toBeNull();
    expect(guard('https://shop.test/api', { 'content-type': 'text/plain' })).toBe(415);
  });

  it('takes request.url’s origin by default and ignores every forwarded header', () => {
    expect(guard('https://shop.test/api', { origin: 'https://shop.test' })).toBeNull();
    const forged = {
      origin: 'https://evil.test',
      'x-forwarded-host': 'evil.test',
      'x-forwarded-proto': 'https',
      host: 'evil.test',
    };
    expect(guard('https://shop.test/api', forged)).toBe(403);
  });

  it('takes the configured origins instead of request.url’s, skipping unusable entries', () => {
    const options = {
      siteOrigin: [' https://www.shop.test/ ', 'ftp://files.shop.test', 'not a url', 42 as never],
    };
    expect(
      guard('http://internal:3000/api', { origin: 'https://www.shop.test' }, options)
    ).toBeNull();
    expect(guard('http://internal:3000/api', { origin: 'http://internal:3000' }, options)).toBe(
      403
    );
    expect(
      guard(
        'http://internal:3000/api',
        { origin: 'https://www.shop.test' },
        {
          siteOrigin: 'https://www.shop.test',
        }
      )
    ).toBeNull();
    // Only unusable entries: nothing is allowed, not even request.url's origin.
    expect(
      guard('https://shop.test/api', { origin: 'https://shop.test' }, { siteOrigin: ['nope'] })
    ).toBe(403);
  });

  it('adds the forwarded origin only with trustForwardedHost', () => {
    const trust = { trustForwardedHost: true };
    const at = 'http://internal:3000/api';
    expect(
      guard(at, { origin: 'https://shop.test', 'x-forwarded-host': 'shop.test, proxy' }, trust)
    ).toBeNull();
    expect(
      guard(at, { origin: 'http://localhost:3000', host: 'localhost:3000' }, trust)
    ).toBeNull();
    expect(
      guard(
        at,
        {
          origin: 'http://shop.test',
          'x-forwarded-host': 'shop.test',
          'x-forwarded-proto': 'http',
        },
        trust
      )
    ).toBeNull();
    // A forwarded proto that is not http(s), or a host that is no host, adds nothing.
    expect(
      guard(
        at,
        { origin: 'ftp://shop.test', 'x-forwarded-host': 'shop.test', 'x-forwarded-proto': 'ftp' },
        trust
      )
    ).toBe(403);
    expect(guard(at, { origin: 'https://shop.test', host: 'bad host' }, trust)).toBe(403);
    expect(guard(at, { origin: 'https://shop.test', 'x-forwarded-host': ' , x' }, trust)).toBe(403);
    // request.url's own origin still counts.
    expect(guard(at, { origin: 'http://internal:3000' }, trust)).toBeNull();
  });
});

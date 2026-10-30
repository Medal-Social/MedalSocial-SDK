import { describe, expect, it } from 'vitest';
import {
  createAddressResolveRoute,
  createDeliveryQuoteRoute,
} from '../../src/next/delivery-routes';
import { createPlaceOrderRoute } from '../../src/next/place-order-route';
import { checkSiteOrigin, postGuard, type SiteOriginOptions } from '../../src/next/shared';

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
    postGuard(
      request,
      { crossOrigin: CROSS as never, notJson: NOT_JSON as never },
      options && checkSiteOrigin(options, 'test')
    )?.status ?? null
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

  it('takes the configured origins instead of request.url’s', () => {
    const options = { siteOrigin: [' https://www.shop.test/ ', 'http://localhost:3000/order'] };
    expect(
      guard('http://internal:3000/api', { origin: 'https://www.shop.test' }, options)
    ).toBeNull();
    expect(
      guard('http://internal:3000/api', { origin: 'http://localhost:3000' }, options)
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
    // A configured origin never falls back to the forwarded headers.
    expect(
      guard(
        'http://internal:3000/api',
        { origin: 'https://evil.test', 'x-forwarded-host': 'evil.test', host: 'evil.test' },
        options
      )
    ).toBe(403);
  });

  it.each([
    ['www.shop.test', 'no scheme'],
    ['ftp://files.shop.test', 'not http(s)'],
    ['not a url', 'not a URL'],
    [42 as unknown as string, 'not text'],
  ])('throws at creation for a siteOrigin it cannot use: %s (%s)', (bad) => {
    const options = { siteOrigin: ['https://www.shop.test', bad] };
    expect(() => checkSiteOrigin(options, 'createX')).toThrow(RangeError);
    expect(() => checkSiteOrigin(options, 'createX')).toThrow(
      `createX: siteOrigin ${JSON.stringify(bad)} is not an http(s) origin`
    );
  });

  it('throws for an empty siteOrigin list, and passes trustForwardedHost on', () => {
    expect(() => checkSiteOrigin({ siteOrigin: [] }, 'createX')).toThrow(/siteOrigin is empty/);
    expect(checkSiteOrigin({ trustForwardedHost: true }, 'createX')).toEqual({
      trustForwardedHost: true,
    });
    expect(checkSiteOrigin({ siteOrigin: 'https://a.test/x' }, 'createX').siteOrigin).toEqual([
      'https://a.test',
    ]);
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

describe('the POST route factories', () => {
  it.each([
    [
      'createPlaceOrderRoute',
      () => createPlaceOrderRoute({ apiKey: 'k', location: 'l', siteOrigin: 'www.shop.test' }),
    ],
    [
      'createAddressResolveRoute',
      () => createAddressResolveRoute({ apiKey: 'k', siteOrigin: 'www.shop.test' }),
    ],
    [
      'createDeliveryQuoteRoute',
      () => createDeliveryQuoteRoute({ apiKey: 'k', siteOrigin: 'www.shop.test' }),
    ],
  ])('%s refuses a siteOrigin without a scheme when created', (name, create) => {
    expect(create).toThrow(`${name}: siteOrigin "www.shop.test" is not an http(s) origin`);
  });
});

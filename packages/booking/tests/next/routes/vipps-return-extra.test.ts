import { describe, expect, it, vi } from 'vitest';
import { resolveBookingConfig } from '../../../src/core/config';
import {
  portalEnabled,
  vippsLinkReturnRoute,
  vippsReturnRoute,
} from '../../../src/next/routes/vipps-return';
import { testCookieJar, testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The portal gate on the two Vipps return routes: the site's own switch when
 * it has one, else the config's `portal.enabled`, and always off for a site
 * with no portal page at all.
 */

const ORIGIN = 'https://salong.example';

describe('portalEnabled', () => {
  it('follows the config when the site has no switch of its own', async () => {
    expect(await portalEnabled(testRuntime())).toBe(true);
    const off = resolveBookingConfig({
      ...PARITY_CONFIG,
      portal: { ...PARITY_CONFIG.portal, enabled: false },
    });
    expect(await portalEnabled(testRuntime({}, { config: off }))).toBe(false);
  });

  it('asks the site’s switch when there is one, over the config', async () => {
    expect(await portalEnabled(testRuntime({}, { portal: { enabled: () => false } }))).toBe(false);
    expect(await portalEnabled(testRuntime({}, { portal: { enabled: async () => true } }))).toBe(
      true
    );
  });

  it('is off for a site with no portal page, whatever the switch says', async () => {
    const base = testRuntime();
    const rt = testRuntime(
      { paths: { ...base.paths, portal: null } },
      { portal: { enabled: () => true } }
    );
    expect(await portalEnabled(rt)).toBe(false);
  });
});

describe('vippsReturnRoute with the portal switched off', () => {
  it('sends the browser home and spends, writes and asks nothing', async () => {
    const takePortalNextPath = vi.fn();
    const exchangeVippsGrant = vi.fn();
    const writePortalSession = vi.fn();
    const rt = testRuntime(
      {
        nextPath: { takePortalNextPath } as never,
        portal: { exchangeVippsGrant } as never,
        session: { writePortalSession } as never,
      },
      { portal: { enabled: async () => false } }
    );

    const response = await vippsReturnRoute(rt, new Request(`${ORIGIN}/min-side/vipps?grant=g`));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(takePortalNextPath).not.toHaveBeenCalled();
    expect(exchangeVippsGrant).not.toHaveBeenCalled();
    expect(writePortalSession).not.toHaveBeenCalled();
  });
});

describe('vippsLinkReturnRoute on a site with no portal page', () => {
  it('sends the browser home with no referrer', async () => {
    const base = testRuntime();
    const readPortalSession = vi.fn();
    const rt = testRuntime({
      paths: { ...base.paths, portal: null },
      session: { readPortalSession } as never,
    });

    const response = await vippsLinkReturnRoute(
      rt,
      new Request(`${ORIGIN}/min-side/vipps/link?link_grant=x`)
    );

    expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(readPortalSession).not.toHaveBeenCalled();
  });
});

/**
 * The login-CSRF guard against the real binding cookie, not a mock: a grant
 * is exchanged only in a browser whose `__Host-` binding cookie is the shape
 * this site mints, and the cookie is spent only after it was read.
 */
describe('vippsReturnRoute — a grant against the real binding cookie', () => {
  const BINDING_COOKIE = PARITY_CONFIG.portal.vippsBindingCookieName;
  // Built, not written out (secret scanners); synthetic.
  const BINDING = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

  function runtime(initial: Record<string, string>) {
    const exchangeVippsGrant = vi.fn(async () => ({ sessionToken: 'token', expiresAt: 1 }));
    const writePortalSession = vi.fn();
    const takePortalNextPath = vi.fn(async () => null);
    const cookies = testCookieJar(initial);
    const rt = testRuntime(
      {
        portal: { exchangeVippsGrant } as never,
        session: { writePortalSession } as never,
        nextPath: { takePortalNextPath } as never,
      },
      { cookies: cookies.source }
    );
    return { rt, exchangeVippsGrant, writePortalSession, cookies };
  }

  const grantRequest = () => new Request(`${ORIGIN}/min-side/vipps?grant=grant-value`);

  it('exchanges the grant, then spends the binding, when this browser started the login', async () => {
    const { rt, exchangeVippsGrant, writePortalSession, cookies } = runtime({
      [BINDING_COOKIE]: BINDING,
    });

    const response = await vippsReturnRoute(rt, grantRequest());

    expect(exchangeVippsGrant).toHaveBeenCalledWith('grant-value');
    expect(writePortalSession).toHaveBeenCalledOnce();
    expect(cookies.values.has(BINDING_COOKIE)).toBe(false);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/min-side`);
  });

  it.each([
    ['no binding cookie at all', {}],
    ['a binding that is not the shape this site mints', { [BINDING_COOKIE]: 'planted' }],
  ])('refuses the grant with %s', async (_label, initial: Record<string, string>) => {
    const { rt, exchangeVippsGrant, writePortalSession, cookies } = runtime(initial);

    const response = await vippsReturnRoute(rt, grantRequest());

    expect(exchangeVippsGrant).not.toHaveBeenCalled();
    expect(writePortalSession).not.toHaveBeenCalled();
    expect(cookies.jar.delete).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/min-side/logg-inn?vipps=failed`);
  });
});

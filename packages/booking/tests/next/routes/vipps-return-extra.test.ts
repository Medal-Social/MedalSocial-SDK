import { describe, expect, it, vi } from 'vitest';
import { resolveBookingConfig } from '../../../src/core/config';
import {
  portalEnabled,
  vippsLinkReturnRoute,
  vippsReturnRoute,
} from '../../../src/next/routes/vipps-return';
import { testRuntime } from '../../support/next-runtime';
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

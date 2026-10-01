import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wiring: one runtime per options object, the defaults every part falls
 * back to, and the public entry's shape.
 */

const jar = vi.hoisted(() => ({
  get: vi.fn((): { value: string } | undefined => undefined),
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => jar), headers: vi.fn() }));

import * as entry from '../../src/next/index';
import { SILENT_LOGGER } from '../../src/next/options';
import { createBookingRuntime } from '../../src/next/runtime';
import {
  createBookingHandler,
  createBookingServer,
  createPortal,
  loadBookingPage,
  loadManagePage,
  loadPortalPage,
  serverFor,
} from '../../src/next/server';
import { testOptions } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

beforeEach(() => {
  jar.get.mockReset().mockReturnValue(undefined);
  jar.set.mockReset();
  jar.delete.mockReset();
});

describe('createBookingRuntime defaults', () => {
  it('reads cookies through next/headers, logs nothing, and derives the portal paths', async () => {
    const options = testOptions();
    delete options.logger;
    const rt = createBookingRuntime(options);
    expect(rt.logger).toBe(SILENT_LOGGER);
    expect(() => rt.logger.warn({}, 'quiet')).not.toThrow();
    jar.get.mockReturnValue({ value: SESSION });
    expect(await rt.session.readPortalSession()).toBe(SESSION);
    expect(jar.get).toHaveBeenCalledWith('demo_portal');
    expect(rt.paths).toMatchObject({
      portal: '/min-side',
      portalLogin: '/min-side/logg-inn',
      sessionExpired: '/api/portal/session/expired',
      vippsReturn: '/min-side/vipps',
      vippsLinkReturn: '/min-side/vipps/link',
    });
    expect(rt.flash.VIPPS_FLASH_COOKIE).toBe('demo_portal_vipps_flash');
    expect(rt.baseUrl()).toBeUndefined();
    expect(rt.messages.invalidPhone).toBe('Telefonnummeret må ha åtte siffer.');
  });

  it('takes the site’s own paths, flash cookie, messages and base URL', () => {
    const rt = createBookingRuntime(
      testOptions({
        baseUrl: () => 'https://salong.example',
        portal: {
          vippsReturnPath: '/konto/vipps',
          vippsLinkReturnPath: '/konto/vipps/koble',
          vippsFlashCookieName: 'demo_flash',
          messages: { invalidPhone: 'Check the number.' },
        },
      })
    );
    expect(rt.paths.vippsReturn).toBe('/konto/vipps');
    expect(rt.paths.vippsLinkReturn).toBe('/konto/vipps/koble');
    expect(rt.flash.VIPPS_FLASH_COOKIE).toBe('demo_flash');
    expect(rt.messages.invalidPhone).toBe('Check the number.');
    expect(rt.messages.invalidBirthYear).toBe('Fødselsåret ser ikke riktig ut.');
    expect(rt.baseUrl()).toBe('https://salong.example');
    expect(createBookingRuntime(testOptions({ baseUrl: 'https://a.example' })).baseUrl()).toBe(
      'https://a.example'
    );
  });

  it('roots the Vipps routes at the booking page when the site has no portal path', () => {
    const config = { ...PARITY_CONFIG, paths: { ...PARITY_CONFIG.paths, portal: null } };
    const rt = createBookingRuntime(testOptions({ config }));
    expect(rt.paths.portal).toBeNull();
    expect(rt.paths.vippsReturn).toBe('/bestill/vipps');
  });

  it('uses every override it is given', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const baseUrl = () => 'https://override.example';
    const rt = createBookingRuntime(testOptions(), { logger, baseUrl });
    expect(rt.logger).toBe(logger);
    expect(rt.baseUrl()).toBe('https://override.example');
  });
});

describe('createBookingServer', () => {
  it('hands out a handler, a portal and the three loaders over one runtime', async () => {
    const server = createBookingServer(testOptions());
    expect(Object.keys(server).sort()).toEqual([
      'handler',
      'loadBookingPage',
      'loadManagePage',
      'loadPortalPage',
      'portal',
    ]);
    expect(Object.keys(server.handler).sort()).toEqual(['DELETE', 'GET', 'POST']);
    expect(Object.keys(server.portal).sort()).toEqual([
      'actions',
      'schemas',
      'session',
      'vippsLinkReturn',
      'vippsReturn',
    ]);
    // No session and no portal reads: the loaders answer from config alone.
    expect(await server.loadPortalPage()).toEqual({
      kind: 'redirect',
      href: '/min-side/logg-inn',
    });
    expect(await server.loadBookingPage({ handoffUrl: 'https://booking.example/' })).toEqual({
      kind: 'redirect',
      href: 'https://booking.example/',
    });
    const manage = await server.loadManagePage('tok');
    expect(manage.kind).toBe('unreachable');
  });

  it('reuses the runtime built for the same options object', async () => {
    const options = testOptions({ portal: { enabled: async () => false } });
    const portal = createPortal(options);
    expect(portal.session).toBe(createPortal(options).session);
    expect(createPortal(testOptions()).session).not.toBe(portal.session);
    expect(await loadPortalPage(options)).toEqual({ kind: 'disabled' });
    expect(await loadBookingPage(options, { handoffUrl: 'https://booking.example/' })).toEqual({
      kind: 'redirect',
      href: 'https://booking.example/',
    });
    expect((await loadManagePage(options, 'tok')).kind).toBe('unreachable');
    const handler = createBookingHandler(options);
    expect((await handler.GET(new Request('https://salong.example/elsewhere'))).status).toBe(404);
  });

  it('wraps a runtime the caller built', () => {
    const rt = createBookingRuntime(testOptions());
    expect(serverFor(rt).portal.session).toBe(rt.session);
  });
});

describe('@medalsocial/booking/next', () => {
  it('exports the server surface', () => {
    for (const name of [
      'createBookingServer',
      'createBookingHandler',
      'createPortal',
      'loadBookingPage',
      'loadManagePage',
      'loadPortalPage',
      'createMedalSeam',
      'MedalConfigError',
      'MedalApiError',
      'createCatalogue',
      'createSeed',
      'createBookingRuntime',
      'PortalSessionExpiredError',
      'isCrossOriginRequest',
    ]) {
      expect(entry).toHaveProperty(name);
    }
  });
});

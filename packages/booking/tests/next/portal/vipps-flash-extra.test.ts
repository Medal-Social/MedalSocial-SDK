import { describe, expect, it } from 'vitest';
import {
  createVippsFlash,
  VIPPS_LINK_FLASHES,
  vippsLinkFlash,
} from '../../../src/next/portal/vipps-flash';
import { testCookieJar } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

const OPTIONS = {
  cookieName: `${PARITY_CONFIG.portal.cookieName}_vipps_flash`,
  path: '/min-side',
};

describe('vippsLinkFlash', () => {
  it.each(VIPPS_LINK_FLASHES.map((flash) => [flash]))('reads %s', (flash) => {
    expect(vippsLinkFlash(flash)).toBe(flash);
  });

  it.each([
    ['an unknown word', 'linked!'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['a number', 1],
    ['an array holding a flash', ['linked']],
  ])('is null for %s', (_label, value) => {
    expect(vippsLinkFlash(value)).toBeNull();
  });
});

describe('createVippsFlash', () => {
  it('names the cookie it was given', () => {
    const { source } = testCookieJar();
    expect(createVippsFlash(OPTIONS, source).VIPPS_FLASH_COOKIE).toBe('demo_portal_vipps_flash');
  });

  it('writes a sixty-second, httpOnly, Secure, Lax cookie on the portal path', async () => {
    const { jar, source } = testCookieJar();

    await createVippsFlash(OPTIONS, source).writeVippsLinkFlash('linked');

    expect(jar.set).toHaveBeenCalledWith('demo_portal_vipps_flash', 'linked', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/min-side',
      maxAge: 60,
    });
  });

  it('reads back one of its own flashes, and nothing else', async () => {
    const ours = testCookieJar({ demo_portal_vipps_flash: 'link_conflict' });
    await expect(createVippsFlash(OPTIONS, ours.source).readVippsLinkFlash()).resolves.toBe(
      'link_conflict'
    );

    const planted = testCookieJar({ demo_portal_vipps_flash: 'admin' });
    await expect(
      createVippsFlash(OPTIONS, planted.source).readVippsLinkFlash()
    ).resolves.toBeNull();

    const none = testCookieJar();
    await expect(createVippsFlash(OPTIONS, none.source).readVippsLinkFlash()).resolves.toBeNull();
  });

  it('clears the cookie with the attributes it was written under', async () => {
    const { jar, values, source } = testCookieJar({ demo_portal_vipps_flash: 'link_failed' });

    await createVippsFlash(OPTIONS, source).clearVippsLinkFlash();

    expect(jar.delete).toHaveBeenCalledWith({
      name: 'demo_portal_vipps_flash',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/min-side',
    });
    expect(values.has('demo_portal_vipps_flash')).toBe(false);
  });

  it('takes a synchronous cookie source too', async () => {
    const { jar } = testCookieJar({ demo_portal_vipps_flash: 'linked' });
    await expect(createVippsFlash(OPTIONS, () => jar).readVippsLinkFlash()).resolves.toBe('linked');
  });
});

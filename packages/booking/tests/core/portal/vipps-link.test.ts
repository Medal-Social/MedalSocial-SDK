import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    set: vi.fn((name: string, value: string, _options: unknown) => values.set(name, value)),
    get: vi.fn((name: string) => (values.has(name) ? { value: values.get(name) } : undefined)),
    delete: vi.fn((options: { name: string }) => values.delete(options.name)),
  };
});

import {
  createVippsLinkCookies,
  isVippsToken,
  mintBrowserBinding,
} from '../../../src/core/portal/vipps-link';
import { PARITY_CONFIG } from '../../support/parity-config';

const {
  clearBrowserBinding,
  clearVippsLinkPair,
  readBrowserBinding,
  readVippsLinkPair,
  VIPPS_BINDING_COOKIE,
  VIPPS_LINK_COOKIE,
  writeBrowserBinding,
  writePendingLink,
} = createVippsLinkCookies(PARITY_CONFIG, async () => jar);

const LINK = ['link', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');

beforeEach(() => {
  jar.values.clear();
  vi.clearAllMocks();
});

describe('the Vipps link cookies (SP10)', () => {
  it('mints a binding of 32 random bytes as 43 base64url characters, fresh each time', () => {
    const one = mintBrowserBinding();
    const two = mintBrowserBinding();
    expect(isVippsToken(one)).toBe(true);
    expect(one).toHaveLength(43);
    expect(one).not.toBe(two);
  });

  it('keeps both httpOnly, secure, lax and short — the link only on the route that spends it', async () => {
    await writeBrowserBinding(mintBrowserBinding());
    await writePendingLink(LINK);

    expect(jar.set).toHaveBeenCalledWith(VIPPS_BINDING_COOKIE, expect.any(String), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 900,
      path: '/',
    });
    expect(jar.set).toHaveBeenCalledWith(VIPPS_LINK_COOKIE, LINK, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 900,
      path: '/api/portal/vipps/link/verify',
    });
  });

  it('names the binding cookie with the __Host- prefix', () => {
    expect(VIPPS_BINDING_COOKIE).toBe('__Host-demo_vipps_bind');
  });

  it('reads the pair back only when BOTH the link and the binding are the right shape', async () => {
    const BINDING = mintBrowserBinding();
    expect(await readVippsLinkPair()).toBeNull();
    jar.values.set(VIPPS_LINK_COOKIE, 'not-a-link');
    jar.values.set(VIPPS_BINDING_COOKIE, BINDING);
    expect(await readVippsLinkPair()).toBeNull();

    // The binding is mandatory: a link without one is no pair.
    jar.values.set(VIPPS_LINK_COOKIE, LINK);
    jar.values.delete(VIPPS_BINDING_COOKIE);
    expect(await readVippsLinkPair()).toBeNull();
    jar.values.set(VIPPS_BINDING_COOKIE, 'malformed');
    expect(await readVippsLinkPair()).toBeNull();
    expect(await readBrowserBinding()).toBeNull();

    jar.values.set(VIPPS_BINDING_COOKIE, BINDING);
    expect(await readVippsLinkPair()).toEqual({ link: LINK, binding: BINDING });
    expect(await readBrowserBinding()).toBe(BINDING);
  });

  it('clears both once spent, with the attributes they were set with and no lifetime', async () => {
    jar.values.set(VIPPS_LINK_COOKIE, LINK);
    jar.values.set(VIPPS_BINDING_COOKIE, LINK);

    await clearVippsLinkPair();

    expect(jar.values.size).toBe(0);
    expect(jar.delete).toHaveBeenCalledWith({
      name: VIPPS_BINDING_COOKIE,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('clears the binding alone', async () => {
    jar.values.set(VIPPS_LINK_COOKIE, LINK);
    jar.values.set(VIPPS_BINDING_COOKIE, LINK);

    await clearBrowserBinding();

    expect([...jar.values.keys()]).toEqual([VIPPS_LINK_COOKIE]);
  });
});

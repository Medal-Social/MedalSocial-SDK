import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vippsFlashRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `DELETE /api/portal/vipps/flash` spends the «Vipps er koblet til» flash;
 * the helpers set it httpOnly, on `/min-side`, for a minute, and read it as a
 * boolean. The cookie jar is faked: these run outside a request.
 */

const jar = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
const rt = testRuntime({}, { cookies: async () => jar as never });
const DELETE = (request: Request) => vippsFlashRoute(rt, request);
const { readVippsLinkFlash, VIPPS_FLASH_COOKIE, writeVippsLinkFlash } = rt.flash;

const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/min-side' };

beforeEach(() => vi.clearAllMocks());

describe('the Vipps link flash', () => {
  it('is set httpOnly, on /min-side, for sixty seconds', async () => {
    await writeVippsLinkFlash('linked');

    expect(jar.set).toHaveBeenCalledWith(VIPPS_FLASH_COOKIE, 'linked', {
      ...ATTRIBUTES,
      maxAge: 60,
    });
  });

  it('reads only its own values as a flash', async () => {
    for (const flash of ['linked', 'link_conflict', 'link_failed']) {
      jar.get.mockReturnValue({ value: flash });
      await expect(readVippsLinkFlash()).resolves.toBe(flash);
    }

    jar.get.mockReturnValue({ value: 'anything' });
    await expect(readVippsLinkFlash()).resolves.toBeNull();

    jar.get.mockReturnValue(undefined);
    await expect(readVippsLinkFlash()).resolves.toBeNull();
  });

  it('is spent by DELETE, same-origin only', async () => {
    const ok = await DELETE(
      new Request('https://salong.example/api/portal/vipps/flash', {
        method: 'DELETE',
        headers: { origin: 'https://salong.example' },
      })
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(jar.delete).toHaveBeenCalledWith({ name: VIPPS_FLASH_COOKIE, ...ATTRIBUTES });

    jar.delete.mockClear();
    const forbidden = await DELETE(
      new Request('https://salong.example/api/portal/vipps/flash', {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      })
    );
    expect(forbidden.status).toBe(403);
    expect(jar.delete).not.toHaveBeenCalled();
  });
});

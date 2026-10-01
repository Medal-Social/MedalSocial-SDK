import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cookie that carries «where does this login end» across the round trip to
 * Vipps and back.
 *
 * Validated on BOTH sides — a value is checked before it is written and again
 * after it is read — so the two assertions worth making here are that a
 * hostile path never reaches the jar, and that one somehow sitting in the jar
 * never reaches a `redirect()`.
 */

const jar = vi.hoisted(() => ({
  get: vi.fn<(name: string) => { value: string } | undefined>(),
  set: vi.fn(),
  delete: vi.fn(),
}));

import { createPortalNextPath } from '../../../src/core/portal/next-path';
import { PARITY_CONFIG } from '../../support/parity-config';

const { PORTAL_NEXT_COOKIE, takePortalNextPath, writePortalNextPath } = createPortalNextPath(
  PARITY_CONFIG,
  async () => jar
);

const FLOW = '/barnehage/lille-eik?fortsett=1';

beforeEach(() => {
  vi.clearAllMocks();
  jar.get.mockReturnValue(undefined);
});

describe('writePortalNextPath', () => {
  it('stores a validated path in an httpOnly, lax, short-lived cookie', async () => {
    await writePortalNextPath(FLOW);

    expect(jar.set).toHaveBeenCalledWith(
      PORTAL_NEXT_COOKIE,
      FLOW,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    );
    const options = jar.set.mock.calls[0][2] as { maxAge: number };
    expect(options.maxAge).toBeGreaterThan(0);
    expect(options.maxAge).toBeLessThanOrEqual(15 * 60);
  });

  /** A destination left behind by an abandoned login must not capture an
   * ordinary one made from Min side a minute later. */
  it('clears rather than keeps an earlier value when there is nothing to store', async () => {
    await writePortalNextPath(null);

    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).toHaveBeenCalledWith({ name: PORTAL_NEXT_COOKIE, path: '/' });
  });

  it.each([
    'https://evil.example/barnehage/x',
    '//evil.example',
    '/\\evil.example',
    '/min-side',
    'barnehage/lille-eik',
  ])('refuses %s and clears instead of storing it', async (value) => {
    await writePortalNextPath(value);

    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).toHaveBeenCalledOnce();
  });
});

describe('takePortalNextPath', () => {
  it('answers the stored path', async () => {
    jar.get.mockReturnValue({ value: FLOW });
    await expect(takePortalNextPath()).resolves.toBe(FLOW);
  });

  /** Read-once: the value describes ONE attempt. */
  it('deletes the cookie as it reads it', async () => {
    jar.get.mockReturnValue({ value: FLOW });
    await takePortalNextPath();
    expect(jar.delete).toHaveBeenCalledWith({ name: PORTAL_NEXT_COOKIE, path: '/' });
  });

  it('is null when there is no cookie, and still clears', async () => {
    await expect(takePortalNextPath()).resolves.toBeNull();
    expect(jar.delete).toHaveBeenCalledOnce();
  });

  /** The cookie is httpOnly, but a cookie is not a promise: a value that got
   * into the jar some other way is validated again on the way out. */
  it('refuses a value in the jar that is not a path this site vouches for', async () => {
    for (const value of ['https://evil.example', '//evil.example', '/api/health']) {
      jar.get.mockReturnValue({ value });
      await expect(takePortalNextPath()).resolves.toBeNull();
    }
  });
});

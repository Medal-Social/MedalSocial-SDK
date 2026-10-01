import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPortalSessionToken } from '../../../src/core/portal/session-cookie';
import { createPortalSession, RENEWED_SESSION_LIFETIME_MS } from '../../../src/next/portal/session';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The cookie jar, faked. The source mocked `next/headers`, which needs a
 * request scope a unit test cannot stand up; here the jar is handed to the
 * factory as its cookie source.
 */
const jar = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const {
  clearPortalSession,
  PORTAL_SESSION_COOKIE,
  readPortalSession,
  renewPortalSession,
  writePortalSession,
} = createPortalSession(PARITY_CONFIG, async () => jar);

/** 43 characters of base64url — what 32 random bytes encode to without padding,
 * and the only shape the portal ever mints. */
// Built, not written out: a 43-char base64url literal reads as a leaked credential to
// secret scanners (DeepSource), and this one is synthetic.
const TOKEN = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

beforeEach(() => {
  jar.get.mockReset();
  jar.set.mockReset();
  jar.delete.mockReset();
});

describe('isPortalSessionToken', () => {
  it('accepts exactly 43 base64url characters', () => {
    expect(TOKEN).toHaveLength(43);
    expect(isPortalSessionToken(TOKEN)).toBe(true);
  });

  it.each([
    ['a short string', 'abc'],
    ['an empty string', ''],
    ['a 44-character string', `${TOKEN}x`],
    ['a 42-character string', TOKEN.slice(1)],
    ['standard base64 with +', `${TOKEN.slice(0, 42)}+`],
    ['standard base64 with /', `${TOKEN.slice(0, 42)}/`],
    ['a padded string with =', `${TOKEN.slice(0, 42)}=`],
    ['a string with a newline in it', `${TOKEN.slice(0, 42)}\n`],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { value: TOKEN }],
  ])('rejects %s', (_label, value) => {
    expect(isPortalSessionToken(value)).toBe(false);
  });
});

describe('readPortalSession', () => {
  it('returns the token when the cookie holds a well-formed one', async () => {
    jar.get.mockReturnValue({ name: PORTAL_SESSION_COOKIE, value: TOKEN });

    await expect(readPortalSession()).resolves.toBe(TOKEN);
    expect(jar.get).toHaveBeenCalledWith(PORTAL_SESSION_COOKIE);
  });

  it('returns null when there is no cookie', async () => {
    jar.get.mockReturnValue(undefined);

    await expect(readPortalSession()).resolves.toBeNull();
  });

  it.each([
    ['too short', 'abc'],
    ['43 characters but with +', `${TOKEN.slice(0, 42)}+`],
    ['43 characters but with /', `${TOKEN.slice(0, 42)}/`],
    ['43 characters but with =', `${TOKEN.slice(0, 42)}=`],
    ['44 characters', `${TOKEN}x`],
  ])('returns null rather than forwarding a cookie that is %s', async (_label, value) => {
    jar.get.mockReturnValue({ name: PORTAL_SESSION_COOKIE, value });

    await expect(readPortalSession()).resolves.toBeNull();
  });
});

describe('writePortalSession', () => {
  it('sets the cookie httpOnly, Secure, Lax, site-wide, expiring when the session does', async () => {
    const expiresAt = Date.UTC(2026, 9, 5, 12, 0, 0);

    await writePortalSession(TOKEN, expiresAt);

    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = jar.set.mock.calls[0];
    expect(name).toBe(PORTAL_SESSION_COOKIE);
    expect(value).toBe(TOKEN);
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt),
    });
    expect(options.expires).toEqual(new Date(expiresAt));
  });

  it.each([
    ['too short', 'abc'],
    ['44 characters', `${TOKEN}x`],
    ['standard base64', `${TOKEN.slice(0, 42)}+`],
  ])('throws on a token that is %s and writes nothing', async (_label, value) => {
    await expect(writePortalSession(value, Date.now())).rejects.toThrow(
      'invalid portal session token'
    );
    expect(jar.set).not.toHaveBeenCalled();
  });
});

/**
 * Medal slides a session to 30 days on use, at most once an hour
 * (`resolveSession`), so after any call it accepted, the session lives at
 * least 30 days minus an hour from now. The cookie is rewritten to exactly
 * that floor: long enough that an active parent is never logged out, never
 * past the moment Medal would answer 401.
 */
describe('renewPortalSession', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('is 30 days less the hour Medal may wait before sliding', () => {
    expect(RENEWED_SESSION_LIFETIME_MS).toBe(30 * DAY - HOUR);
  });

  it('rewrites the cookie, same attributes, to now + 30 d − 1 h', async () => {
    const now = Date.UTC(2026, 9, 5, 12, 0, 0);

    await renewPortalSession(TOKEN, now);

    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = jar.set.mock.calls[0];
    expect(name).toBe(PORTAL_SESSION_COOKIE);
    expect(value).toBe(TOKEN);
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(now + 30 * DAY - HOUR),
    });
  });

  it('refuses a malformed token like the writer does', async () => {
    await expect(renewPortalSession('abc', Date.now())).rejects.toThrow(
      'invalid portal session token'
    );
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe('clearPortalSession', () => {
  it('deletes the cookie by name on the same path it was written under', async () => {
    await clearPortalSession();

    expect(jar.delete).toHaveBeenCalledTimes(1);
    expect(jar.delete).toHaveBeenCalledWith({ name: PORTAL_SESSION_COOKIE, path: '/' });
  });
});

describe('PORTAL_SESSION_COOKIE', () => {
  it('is the name the portal routes and the middleware agree on', () => {
    expect(PORTAL_SESSION_COOKIE).toBe('demo_portal');
  });
});

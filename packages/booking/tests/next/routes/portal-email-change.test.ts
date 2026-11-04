import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PortalEmailChangeRefusedError,
  PortalEmailChangeUnavailableError,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
} from '../../../src/next/portal/medal-portal';
import {
  emailChangeStartRoute,
  emailChangeVerifyRoute,
} from '../../../src/next/routes/portal-routes';
import { testCookieJar, testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * `POST /api/portal/email/{start,verify}` — «Endre e-post» from Min side. The
 * session comes from the cookie; verify SWAPS the cookie for the replacement
 * session Medal minted (the presented one is dead) and never answers with it.
 */

const SITE = 'https://salong.example';
const COOKIE = PARITY_CONFIG.portal.cookieName;
const OLD = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const NEW = ['zyxwvutsrqponmlkjihgfedcba', 'MLKJIHGFEDCBA', '9_-0'].join('');

const startEmailChange = vi.fn();
const verifyEmailChange = vi.fn();
const getMe = vi.fn();

function setup(initial: Record<string, string> = { [COOKIE]: OLD }) {
  const cookies = testCookieJar(initial);
  const rt = testRuntime(
    { portal: { startEmailChange, verifyEmailChange, getMe } as never },
    { cookies: cookies.source }
  );
  return { rt, cookies };
}

function post(path: string, body: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(`${SITE}/api/portal/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  startEmailChange.mockResolvedValue({ to: 'k•••@e•••.com' });
  verifyEmailChange.mockResolvedValue({
    email: 'kari.ny@example.com',
    sessionToken: NEW,
    expiresAt: 1790812800000,
  });
});

describe('POST /api/portal/email/start', () => {
  it('starts the change with the cookie session and answers the masked address', async () => {
    const { rt } = setup();

    const response = await emailChangeStartRoute(
      rt,
      post('email/start', { email: ' Kari.Ny@Example.com ' })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, to: 'k•••@e•••.com' });
    expect(startEmailChange).toHaveBeenCalledWith(OLD, 'kari.ny@example.com', 'no');
  });

  it('drops a mask that is not the expected shape', async () => {
    startEmailChange.mockResolvedValue({ to: 'kari.ny@example.com' });
    const { rt } = setup();

    const response = await emailChangeStartRoute(rt, post('email/start', { email: 'a@b.no' }));

    expect(await response.json()).toEqual({ ok: true, to: null });
  });

  it('is `session` without a cookie, and never asks Medal', async () => {
    const { rt } = setup({});

    const response = await emailChangeStartRoute(rt, post('email/start', { email: 'a@b.no' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: 'session' });
    expect(startEmailChange).not.toHaveBeenCalled();
  });

  it('refuses another origin, a request with no origin, a bad address and an extra key', async () => {
    const { rt } = setup();

    const foreign = await emailChangeStartRoute(
      rt,
      post('email/start', { email: 'a@b.no' }, { origin: 'https://evil.example' })
    );
    expect(foreign.status).toBe(403);
    expect(
      (await emailChangeStartRoute(rt, post('email/start', { email: 'a@b.no' }, {}))).status
    ).toBe(403);
    expect((await emailChangeStartRoute(rt, post('email/start', { email: 'nope' }))).status).toBe(
      400
    );
    expect(
      (await emailChangeStartRoute(rt, post('email/start', { email: 'a@b.no', locale: 'en' })))
        .status
    ).toBe(400);
    expect(startEmailChange).not.toHaveBeenCalled();
  });

  it.each([
    [
      new PortalEmailChangeRefusedError('unchanged'),
      422,
      { reason: 'refused', refusal: 'unchanged' },
    ],
    [
      new PortalEmailChangeRefusedError('too_many_codes'),
      422,
      { reason: 'refused', refusal: 'too_many_codes' },
    ],
    [new PortalSessionExpiredError(), 401, { reason: 'session' }],
    [new PortalValidationError('email is invalid'), 400, { reason: 'invalid' }],
    [new PortalThrottledError(), 429, { reason: 'throttled' }],
    [new PortalEmailChangeUnavailableError(), 503, { reason: 'unavailable' }],
    [new Error('boom'), 503, { reason: 'unreachable' }],
  ])('maps %s to %i', async (thrown, status, body) => {
    startEmailChange.mockRejectedValue(thrown);
    const { rt, cookies } = setup();

    const response = await emailChangeStartRoute(rt, post('email/start', { email: 'a@b.no' }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, ...body });
    // A refusal never logs the customer out here; only Medal refusing the
    // session drops the (dead) cookie.
    if (thrown instanceof PortalSessionExpiredError) {
      expect(cookies.values.has(COOKIE)).toBe(false);
    } else {
      expect(cookies.jar.delete).not.toHaveBeenCalled();
    }
  });
});

describe('POST /api/portal/email/verify', () => {
  it('swaps the session cookie for the replacement and never answers with a token', async () => {
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '007123' }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({ ok: true, email: 'kari.ny@example.com', signedIn: true });
    expect(verifyEmailChange).toHaveBeenCalledWith(OLD, '007123', 'no');
    expect(cookies.values.get(COOKIE)).toBe(NEW);
    expect(cookies.jar.set).toHaveBeenCalledWith(COOKIE, NEW, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(1790812800000),
    });
    expect(text).not.toContain(NEW);
    expect(text).not.toContain(OLD);
  });

  it('uses the configured portal locale', async () => {
    const cookies = testCookieJar({ [COOKIE]: OLD });
    const rt = testRuntime(
      { portal: { startEmailChange, verifyEmailChange, getMe } as never },
      { cookies: cookies.source, portal: { locale: 'en' } }
    );

    await emailChangeVerifyRoute(rt, post('email/verify', { code: '007123' }));

    expect(verifyEmailChange).toHaveBeenCalledWith(OLD, '007123', 'en');
  });

  it('keeps the cookie on a wrong code: 422 code_invalid is not a logout', async () => {
    verifyEmailChange.mockRejectedValue(new PortalEmailChangeRefusedError('code_invalid'));
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '000000' }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'refused',
      refusal: 'code_invalid',
    });
    expect(cookies.values.get(COOKIE)).toBe(OLD);
    expect(cookies.jar.set).not.toHaveBeenCalled();
    expect(cookies.jar.delete).not.toHaveBeenCalled();
  });

  it('passes email_taken through, the cookie untouched', async () => {
    verifyEmailChange.mockRejectedValue(new PortalEmailChangeRefusedError('email_taken'));
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(await response.json()).toEqual({
      ok: false,
      reason: 'refused',
      refusal: 'email_taken',
    });
    expect(cookies.values.get(COOKIE)).toBe(OLD);
  });

  it('takes six digits and nothing else', async () => {
    const { rt } = setup();

    expect((await emailChangeVerifyRoute(rt, post('email/verify', { code: '12345' }))).status).toBe(
      400
    );
    expect(
      (await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456', email: 'x@y.no' })))
        .status
    ).toBe(400);
    expect((await emailChangeVerifyRoute(rt, post('email/verify', '{not json'))).status).toBe(400);
    expect(verifyEmailChange).not.toHaveBeenCalled();
  });

  it('is `session` for a dead session and without a cookie', async () => {
    verifyEmailChange.mockRejectedValue(new PortalSessionExpiredError());
    const { rt, cookies } = setup();
    const dead = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));
    expect(dead.status).toBe(401);
    expect(await dead.json()).toEqual({ ok: false, reason: 'session' });
    // The dead cookie goes, so the login page cannot bounce back to the portal.
    expect(cookies.values.has(COOKIE)).toBe(false);

    const none = setup({});
    const missing = await emailChangeVerifyRoute(none.rt, post('email/verify', { code: '123456' }));
    expect(missing.status).toBe(401);
  });

  it('refuses another origin', async () => {
    const { rt } = setup();

    const response = await emailChangeVerifyRoute(
      rt,
      post('email/verify', { code: '123456' }, { origin: 'https://evil.example' })
    );

    expect(response.status).toBe(403);
    expect(verifyEmailChange).not.toHaveBeenCalled();
  });

  it('says signedIn: false and clears the dead cookie when the replacement cannot be stored', async () => {
    verifyEmailChange.mockResolvedValue({
      email: 'kari.ny@example.com',
      sessionToken: 'not a token',
      expiresAt: 1790812800000,
    });
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      email: 'kari.ny@example.com',
      signedIn: false,
    });
    expect(cookies.values.has(COOKIE)).toBe(false);
  });

  it('logs and answers unreachable when the answer was lost but the session still lives', async () => {
    verifyEmailChange.mockRejectedValue(new Error('boom'));
    getMe.mockResolvedValue({ email: 'kari@example.com' });
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: 'unreachable' });
    expect(rt.logger.error).toHaveBeenCalled();
    expect(getMe).toHaveBeenCalledWith(OLD);
    expect(cookies.values.get(COOKIE)).toBe(OLD);
  });

  it('answers unconfirmed and drops the dead cookie when the answer was lost AND the session is revoked', async () => {
    verifyEmailChange.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    getMe.mockRejectedValue(new PortalSessionExpiredError());
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, reason: 'unconfirmed' });
    expect(cookies.values.has(COOKIE)).toBe(false);
  });

  it('keeps the cookie when the probe itself cannot reach Medal', async () => {
    verifyEmailChange.mockRejectedValue(new Error('boom'));
    getMe.mockRejectedValue(new Error('still down'));
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(response.status).toBe(503);
    expect(cookies.values.get(COOKIE)).toBe(OLD);
  });

  it('never probes after a classified refusal', async () => {
    verifyEmailChange.mockRejectedValue(new PortalEmailChangeRefusedError('code_invalid'));
    const { rt } = setup();

    await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(getMe).not.toHaveBeenCalled();
  });

  it('says signedIn: false when Medal changed the address but sent no session', async () => {
    verifyEmailChange.mockResolvedValue({
      email: 'kari.ny@example.com',
      sessionToken: null,
      expiresAt: null,
    });
    const { rt, cookies } = setup();

    const response = await emailChangeVerifyRoute(rt, post('email/verify', { code: '123456' }));

    expect(await response.json()).toEqual({
      ok: true,
      email: 'kari.ny@example.com',
      signedIn: false,
    });
    expect(cookies.values.has(COOKIE)).toBe(false);
  });
});

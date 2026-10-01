import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalProfileDto } from '../../../src/core/portal/dto';
import { PortalThrottledError } from '../../../src/next/portal/medal-portal';
import { loginVerifyRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `POST /api/portal/login/verify` — the e-mail code exchanged for the Min side
 * session cookie.
 *
 * A route handler rather than a server action because a server action that
 * sets a cookie makes Next re-fetch the page that called it: behind the login
 * sheet that was the whole `/bestill` page, and on `/min-side/logg-inn` a
 * second render racing the form's own navigation. What it owes the browser is
 * what the action did — the same validation, the same reasons, the parent
 * narrowed to the wizard's DTO — and never the token.
 */

const session = {
  writePortalSession: vi.fn<(token: string, expiresAt: number) => Promise<void>>(),
};
const verifyLogin = vi.fn();
const getMe = vi.fn();
const getMyBookings = vi.fn(async () => ({ upcoming: [], past: [] }));

const rt = testRuntime({
  session: session as never,
  portal: { verifyLogin, getMe, getMyBookings } as never,
});
const POST = (request: Request) => loginVerifyRoute(rt, request);

// Built, not written out: a 43-char base64url literal reads as a leaked
// credential to secret scanners, and this one is synthetic.
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.com',
  firstName: 'Kari',
  lastName: null,
  phone: '40000000',
  family: [
    {
      personId: null,
      name: 'Ola',
      birthYear: 2018,
      birthMonth: null,
      notes: null,
      preferredResourceId: null,
    },
  ],
  personDetails: false,
  marketingConsent: false,
};

const SITE = 'https://salong.example';

function post(
  body: unknown,
  headers: Record<string, string> = { origin: SITE, 'content-type': 'application/json' }
): Request {
  return new Request(`${SITE}/api/portal/login/verify`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyLogin).mockResolvedValue({ sessionToken: SESSION, expiresAt: 1234 });
  vi.mocked(getMe).mockResolvedValue(PROFILE);
});

describe('POST /api/portal/login/verify', () => {
  it('writes the cookie and answers with the guardian — without the token', async () => {
    const response = await POST(post({ email: 'kari@example.com', code: '123456' }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({
      ok: true,
      guardian: {
        firstName: 'Kari',
        lastName: null,
        email: 'kari@example.com',
        phone: '40000000',
        family: [{ name: 'Ola', birthYear: 2018 }],
      },
    });
    expect(session.writePortalSession).toHaveBeenCalledWith(SESSION, 1234);
    // Read with the token just minted, not out of the jar.
    expect(getMe).toHaveBeenCalledWith(SESSION);
    expect(text).not.toContain(SESSION);
    // The narrowing: nothing the wizard does not render crosses over.
    expect(text).not.toContain('ct-1');
    expect(text).not.toContain('marketingConsent');
  });

  /** The login worked; only the read after it did not. Still a login. */
  it('still answers ok when the profile cannot be read afterwards', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('fetch failed'));

    const response = await POST(post({ email: 'kari@example.com', code: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, guardian: null });
    expect(session.writePortalSession).toHaveBeenCalledWith(SESSION, 1234);
  });

  it('answers «invalid» to a wrong code and writes nothing', async () => {
    vi.mocked(verifyLogin).mockResolvedValue(null);

    const response = await POST(post({ email: 'kari@example.com', code: '000000' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });

  it('answers «throttled» when Medal has had enough guesses', async () => {
    vi.mocked(verifyLogin).mockRejectedValue(new PortalThrottledError());

    const response = await POST(post({ email: 'kari@example.com', code: '000000' }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, reason: 'throttled' });
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });

  it('answers «unreachable» when Medal cannot be asked', async () => {
    vi.mocked(verifyLogin).mockRejectedValue(new Error('upstream 502'));

    const response = await POST(post({ email: 'kari@example.com', code: '123456' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: 'unreachable' });
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });

  it.each(['12345', '1234567', '12345a', '', ' 123456 x'])(
    'refuses a code that is not six digits: %j',
    async (code) => {
      const response = await POST(post({ email: 'kari@example.com', code }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, reason: 'invalid' });
      expect(verifyLogin).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['not JSON', '{nope'],
    ['no address', { code: '123456' }],
    ['a bad address', { email: 'kari@', code: '123456' }],
  ])('refuses a malformed body: %s', async (_case, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(verifyLogin).not.toHaveBeenCalled();
  });

  it('lowercases the address so the code is checked against the one it was sent to', async () => {
    await POST(post({ email: ' Kari@Example.com ', code: '123456' }));

    expect(verifyLogin).toHaveBeenCalledWith('kari@example.com', '123456');
  });

  /** It mints a session, so another origin must not be able to log a visitor in. */
  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['a garbled origin', { origin: 'null' }],
    ['no origin at all', {}],
  ])('refuses %s', async (_case, headers) => {
    const response = await POST(
      post({ email: 'kari@example.com', code: '123456' }, headers as Record<string, string>)
    );

    expect(response.status).toBe(403);
    expect(verifyLogin).not.toHaveBeenCalled();
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });
});

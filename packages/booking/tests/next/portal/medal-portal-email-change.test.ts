import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam } from '../../../src/next/medal';
import {
  createPortalSeam,
  PortalEmailChangeRefusedError,
  PortalEmailChangeUnavailableError,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
} from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

const { startEmailChange, verifyEmailChange } = createPortalSeam(
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  }),
  { config: PARITY_CONFIG }
);

/**
 * «Endre e-post» on the wire (medal-monorepo #7248): the two session-bound
 * routes, what is sent, the replacement session on success, and every
 * refusal as the seam's own error — never a dead session for a wrong code.
 */

const API_KEY = ['test', 'api', 'key', 'not', 'real'].join('-');
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const NEW_SESSION = ['zyxwvutsrqponmlkjihgfedcba', 'MLKJIHGFEDCBA', '9_-0'].join('');

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

function stubMedal(answer: { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      calls.push({
        method: (init.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      });
      return typeof answer.body === 'string'
        ? new Response(answer.body, { status: answer.status })
        : Response.json(answer.body, { status: answer.status });
    })
  );
  return calls;
}

function refused(reason: string) {
  return {
    status: 422,
    body: {
      error: {
        code: 'PORTAL_EMAIL_CHANGE_REFUSED',
        message: `The e-mail address could not be changed ${SESSION}`,
        details: { reason },
      },
    },
  };
}

function error(status: number, code: string, message = `Medal says ${SESSION}`) {
  return { status, body: { error: { code, message } } };
}

beforeEach(() => {
  vi.stubEnv('MEDAL_API_KEY', API_KEY);
  vi.stubEnv('MEDAL_API_ENDPOINT', 'https://medal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('startEmailChange', () => {
  it('posts the new address and locale with the session, and answers the mask', async () => {
    const calls = stubMedal({ status: 200, body: { data: { sent: true, to: 'k•••@e•••.com' } } });

    await expect(startEmailChange(SESSION, 'kari.ny@example.com', 'en')).resolves.toEqual({
      to: 'k•••@e•••.com',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/v1/portal/me/email/start');
    expect(calls[0]?.body).toEqual({ email: 'kari.ny@example.com', locale: 'en' });
    expect(calls[0]?.headers.get('x-portal-session')).toBe(SESSION);
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  it('defaults the locale to Norwegian and reads a missing mask as null', async () => {
    const calls = stubMedal({ status: 200, body: { data: { sent: true } } });

    await expect(startEmailChange(SESSION, 'kari.ny@example.com')).resolves.toEqual({ to: null });
    expect(calls[0]?.body).toEqual({ email: 'kari.ny@example.com', locale: 'no' });
  });

  it.each(['unchanged', 'too_many_codes'])(
    'turns the 422 reason %s into PortalEmailChangeRefusedError',
    async (reason) => {
      stubMedal(refused(reason));

      const thrown = await startEmailChange(SESSION, 'kari.ny@example.com').catch((e) => e);
      expect(thrown).toBeInstanceOf(PortalEmailChangeRefusedError);
      expect(thrown.reason).toBe(reason);
    }
  );

  it.each(['something_new', 'email_blocked'])('does not trust the reason %s', async (reason) => {
    stubMedal(refused(reason));

    const thrown = await startEmailChange(SESSION, 'kari.ny@example.com').catch((e) => e);
    expect(thrown).not.toBeInstanceOf(PortalEmailChangeRefusedError);
    expect(String(thrown.message)).not.toContain(SESSION);
  });

  it('maps a dead session, a throttle, a validation error and a missing route', async () => {
    stubMedal(error(401, 'PORTAL_SESSION_INVALID'));
    await expect(startEmailChange(SESSION, 'a@b.no')).rejects.toBeInstanceOf(
      PortalSessionExpiredError
    );

    stubMedal(error(429, 'RATE_LIMITED'));
    await expect(startEmailChange(SESSION, 'a@b.no')).rejects.toBeInstanceOf(PortalThrottledError);

    stubMedal(error(400, 'VALIDATION_ERROR'));
    await expect(startEmailChange(SESSION, 'a@b.no')).rejects.toBeInstanceOf(PortalValidationError);

    stubMedal(error(404, 'NOT_FOUND', 'No matching routes found'));
    await expect(startEmailChange(SESSION, 'a@b.no')).rejects.toBeInstanceOf(
      PortalEmailChangeUnavailableError
    );
  });

  it('rethrows a failure that is not an answer from Medal (no network)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(`fetch failed for ${SESSION}`);
      })
    );

    const thrown = await startEmailChange(SESSION, 'a@b.no').catch((e) => e);
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown.message)).not.toContain(SESSION);
  });

  it('keeps the session out of an unexpected failure', async () => {
    stubMedal(error(500, 'INTERNAL'));

    const thrown = await startEmailChange(SESSION, 'a@b.no').catch((e) => e);
    expect(`${thrown.message}\n${thrown.stack}`).not.toContain(SESSION);
    expect(`${thrown.message}\n${thrown.stack}`).not.toContain(API_KEY);
  });

  it('refuses a 2xx that is not «sent»', async () => {
    stubMedal({ status: 200, body: { data: { sent: false } } });

    await expect(startEmailChange(SESSION, 'a@b.no')).rejects.toMatchObject({
      code: 'NON_JSON_BODY',
    });
  });
});

describe('verifyEmailChange', () => {
  const OK = {
    status: 200,
    body: {
      data: {
        email: 'kari.ny@example.com',
        session_token: NEW_SESSION,
        expires_at: 1790812800000,
        expires_at_iso: '2026-09-30T16:00:00.000Z',
      },
    },
  };

  it('posts the code and answers the new address and the REPLACEMENT session', async () => {
    const calls = stubMedal(OK);

    await expect(verifyEmailChange(SESSION, '007123')).resolves.toEqual({
      email: 'kari.ny@example.com',
      sessionToken: NEW_SESSION,
      expiresAt: 1790812800000,
    });
    expect(calls[0]?.path).toBe('/api/v1/portal/me/email/verify');
    expect(calls[0]?.body).toEqual({ code: '007123', locale: 'no' });
    expect(calls[0]?.headers.get('x-portal-session')).toBe(SESSION);
  });

  it('is a refusal, not a dead session, for a wrong code', async () => {
    stubMedal(refused('code_invalid'));

    const thrown = await verifyEmailChange(SESSION, '000000').catch((e) => e);
    expect(thrown).toBeInstanceOf(PortalEmailChangeRefusedError);
    expect(thrown.reason).toBe('code_invalid');
  });

  it('passes email_taken through', async () => {
    stubMedal(refused('email_taken'));

    const thrown = await verifyEmailChange(SESSION, '123456').catch((e) => e);
    expect(thrown.reason).toBe('email_taken');
  });

  it('reports a success without a usable session as CHANGED, with no session', async () => {
    stubMedal({ status: 200, body: { data: { email: 'kari.ny@example.com' } } });

    await expect(verifyEmailChange(SESSION, '123456')).resolves.toEqual({
      email: 'kari.ny@example.com',
      sessionToken: null,
      expiresAt: null,
    });
  });

  it('refuses a success that does not even name the address', async () => {
    stubMedal({ status: 200, body: { data: { session_token: NEW_SESSION } } });

    await expect(verifyEmailChange(SESSION, '123456')).rejects.toMatchObject({
      code: 'NON_JSON_BODY',
    });
  });

  it('keeps the session and the code out of an unexpected failure', async () => {
    stubMedal(error(502, 'BAD_GATEWAY', `upstream echoed 314159 and ${SESSION}`));

    const thrown = await verifyEmailChange(SESSION, '314159').catch((e) => e);
    const text = `${thrown.message}\n${thrown.stack}`;
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(API_KEY);
  });
});

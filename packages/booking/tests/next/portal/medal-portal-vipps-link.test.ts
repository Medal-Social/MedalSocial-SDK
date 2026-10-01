import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam } from '../../../src/next/medal';
import {
  createPortalSeam,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalVippsUnavailableError,
} from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

/** Key and origin read per call, so `vi.stubEnv` drives the seam as it drove the source. */
const { completeVippsLink, startVippsLink } = createPortalSeam(
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  }),
  { config: PARITY_CONFIG }
);

/**
 * «Koble til Vipps» from Min side → Profil, on the wire: the two session-bound
 * routes Medal is adding (`/me/vipps/link/start` and `/complete`), what is
 * sent, how the answers read — and the FEATURE DETECTION: a start that
 * answers with a missing route is `null`, and the row hides.
 */

// Built, not written out: a literal key reads as a leaked credential to
// secret scanners, and this one is synthetic.
const API_KEY = ['test', 'api', 'key', 'not', 'real'].join('-');
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const BINDING = 'b'.repeat(43);
const GRANT = 'g'.repeat(43);

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

function error(status: number, code: string) {
  return { status, body: { error: { code, message: `Medal says ${SESSION} ${GRANT}` } } };
}

beforeEach(() => {
  vi.stubEnv('MEDAL_API_KEY', API_KEY);
  vi.stubEnv('MEDAL_API_ENDPOINT', 'https://medal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const START = {
  returnUrl: 'https://salong.example/min-side/vipps/koble',
  browserBinding: BINDING,
  locale: 'no' as const,
};

describe('startVippsLink', () => {
  it('posts the return URL, binding and locale with the session', async () => {
    const calls = stubMedal({
      status: 200,
      body: { data: { authorize_url: 'https://api.vipps.no/authorize?x=1' } },
    });

    await expect(startVippsLink(SESSION, START)).resolves.toEqual({
      authorizeUrl: 'https://api.vipps.no/authorize?x=1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/v1/portal/me/vipps/link/start');
    expect(calls[0].headers.get('x-portal-session')).toBe(SESSION);
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body).toEqual({
      return_url: START.returnUrl,
      browser_binding: BINDING,
      locale: 'no',
    });
  });

  it('is null against a Medal without the route — the row hides', async () => {
    stubMedal({ status: 404, body: 'No matching routes found' });

    await expect(startVippsLink(SESSION, START)).resolves.toBeNull();
  });

  it('refuses an authorize URL that is not HTTPS', async () => {
    stubMedal({ status: 200, body: { data: { authorize_url: 'http://evil.test' } } });

    await expect(startVippsLink(SESSION, START)).rejects.toThrow(/malformed/);
  });

  it('is null — the row hides — for a workspace without Vipps (503 VIPPS_NOT_CONFIGURED)', async () => {
    stubMedal(error(503, 'VIPPS_NOT_CONFIGURED'));

    await expect(startVippsLink(SESSION, START)).resolves.toBeNull();
  });

  it('maps a dead session and a throttle, and rethrows any other 503', async () => {
    stubMedal(error(401, 'PORTAL_SESSION_INVALID'));
    await expect(startVippsLink(SESSION, START)).rejects.toBeInstanceOf(PortalSessionExpiredError);

    stubMedal(error(503, 'SERVICE_UNAVAILABLE'));
    await expect(startVippsLink(SESSION, START)).rejects.not.toBeInstanceOf(
      PortalVippsUnavailableError
    );

    stubMedal(error(429, 'RATE_LIMITED'));
    await expect(startVippsLink(SESSION, START)).rejects.toBeInstanceOf(PortalThrottledError);
  });

  it('keeps the session and the binding out of anything it throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`fetch failed for ${SESSION} with ${BINDING} and ${API_KEY}`);
      })
    );

    const thrown = await startVippsLink(SESSION, START).catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(Error);
    const text = `${(thrown as Error).message} ${(thrown as Error).stack}`;
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(BINDING);
    expect(text).not.toContain(API_KEY);
  });
});

describe('completeVippsLink', () => {
  it('posts the grant and binding with the session and key, and reads status «linked»', async () => {
    const calls = stubMedal({
      status: 200,
      body: { data: { status: 'linked', already_linked: false } },
    });

    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).resolves.toBe('linked');
    expect(calls[0].path).toBe('/api/v1/portal/me/vipps/link/complete');
    expect(calls[0].headers.get('x-portal-session')).toBe(SESSION);
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body).toEqual({ grant: GRANT, browser_binding: BINDING });
  });

  it('reads an already-linked account as linked too', async () => {
    stubMedal({ status: 200, body: { data: { status: 'linked', already_linked: true } } });

    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).resolves.toBe('linked');
  });

  it('refuses a 2xx that does not say «linked»', async () => {
    stubMedal({ status: 200, body: { data: { status: 'pending' } } });

    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).rejects.toThrow(/malformed/);
  });

  it('reads a 409 as a Vipps account already bound to someone else', async () => {
    stubMedal(error(409, 'VIPPS_IDENTITY_CONFLICT'));

    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).resolves.toBe('conflict');
  });

  it('reads a refused, spent or unknown grant as invalid', async () => {
    for (const refusal of [
      error(401, 'PORTAL_CODE_INVALID'),
      error(404, 'LINK_GRANT_NOT_FOUND'),
      error(400, 'INVALID_INPUT'),
    ]) {
      stubMedal(refusal);
      await expect(
        completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
      ).resolves.toBe('invalid');
    }
  });

  it('maps a dead session and a throttle, and scrubs the grant', async () => {
    stubMedal(error(401, 'PORTAL_SESSION_REQUIRED'));
    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).rejects.toBeInstanceOf(PortalSessionExpiredError);

    stubMedal(error(429, 'RATE_LIMITED'));
    await expect(
      completeVippsLink(SESSION, { grant: GRANT, browserBinding: BINDING })
    ).rejects.toBeInstanceOf(PortalThrottledError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`boom ${GRANT} ${SESSION} ${BINDING}`);
      })
    );
    const thrown = await completeVippsLink(SESSION, {
      grant: GRANT,
      browserBinding: BINDING,
    }).catch((caught: unknown) => caught);
    const text = `${(thrown as Error).message} ${(thrown as Error).stack}`;
    expect(text).not.toContain(GRANT);
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(BINDING);
  });
});

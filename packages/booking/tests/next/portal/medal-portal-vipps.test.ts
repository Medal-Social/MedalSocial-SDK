import { MedalApiError, MedalNetworkError } from '@medalsocial/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam, MedalConfigError } from '../../../src/next/medal';
import {
  createPortalSeam,
  PortalThrottledError,
  PortalValidationError,
  PortalVippsConflictError,
  PortalVippsUnavailableError,
} from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

/** Key and origin read per call, so `vi.stubEnv` drives the seam as it drove the source. */
const { exchangeVippsGrant, startVippsLogin, verifyVippsLink } = createPortalSeam(
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  }),
  { config: PARITY_CONFIG }
);

/**
 * The two Vipps routes of the portal seam, driven over a stubbed `fetch`.
 *
 * Unlike `medal-portal.test.ts`, which fakes the SDK's `portal` namespace,
 * these go to the wire: the installed SDK has no method for either route, so
 * the seam builds the request itself, and what is asserted is the request —
 * the origin from `MEDAL_API_ENDPOINT`, the API key in `Authorization`, the
 * snake_case body — and the reading of the platform's standard envelopes:
 * `{ data }` on a 2xx, `{ error: { code, message } }` otherwise, with the
 * mapping of each code the contract names. The last block is the one this
 * file exists for: the grant, the token it buys and the API key are bearer
 * credentials, and none of them may be in anything the seam throws.
 */

type FetchMock = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function stubFetch(body: unknown, status = 200): FetchMock {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(body, { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

/** The platform's standard envelopes: `{ data }` on a 2xx, `{ error: { code, message } }` otherwise. */
function ok(data: unknown): FetchMock {
  return stubFetch({ data });
}

function failed(status: number, code: string, message = `${code} from the engine`): FetchMock {
  return stubFetch({ error: { code, message } }, status);
}

// Built, not written out: a literal key reads as a leaked credential to
// secret scanners, and this one is synthetic.
const API_KEY = ['test', 'api', 'key', 'not', 'real'].join('-');
const RETURN_URL = 'https://salong.example/min-side/vipps';
const GRANT = 'grant-opaque-value-1234567890';
// Built, not written out: a 43-char base64url literal reads as a leaked credential to
// secret scanners (DeepSource), and this one is synthetic.
const TOKEN = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

beforeEach(() => {
  vi.stubEnv('MEDAL_API_KEY', API_KEY);
  vi.stubEnv('MEDAL_API_ENDPOINT', 'https://medal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('startVippsLogin', () => {
  it('posts the return URL with the API key and hands back the authorize URL', async () => {
    const fetchMock = ok({ authorize_url: 'https://api.vipps.no/authorize?x=1' });

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).resolves.toEqual({
      authorizeUrl: 'https://api.vipps.no/authorize?x=1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://medal.test/api/v1/portal/vipps/start');
    expect(init.method).toBe('POST');
    expect(header(init, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(header(init, 'content-type')).toBe('application/json');
    // `locale` for the code e-mail a conflicted login sends (SP10).
    expect(JSON.parse(String(init.body))).toEqual({ return_url: RETURN_URL, locale: 'no' });
  });

  it('sends this browser’s binding, and keeps it out of anything it throws', async () => {
    const BINDING = ['bind', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');
    const fetchMock = ok({ authorize_url: 'https://api.vipps.no/authorize?x=1' });

    await startVippsLogin({ returnUrl: RETURN_URL, browserBinding: BINDING });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      return_url: RETURN_URL,
      browser_binding: BINDING,
      locale: 'no',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`socket closed while sending ${BINDING}`);
      })
    );
    const error = (await startVippsLogin({
      returnUrl: RETURN_URL,
      browserBinding: BINDING,
    }).catch((thrown: unknown) => thrown)) as Error;
    expect(String(error.message)).not.toContain(BINDING);
    expect(String(error.stack)).not.toContain(BINDING);
  });

  it('turns 503 VIPPS_NOT_CONFIGURED into PortalVippsUnavailableError', async () => {
    failed(503, 'VIPPS_NOT_CONFIGURED', 'Vipps is not configured for this workspace');

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(
      PortalVippsUnavailableError
    );
  });

  it('turns 400 INVALID_RETURN_URL into PortalValidationError naming the code', async () => {
    failed(400, 'INVALID_RETURN_URL', 'return_url must be on the workspace site');

    await expect(startVippsLogin({ returnUrl: 'http://evil.example' })).rejects.toMatchObject({
      name: 'PortalValidationError',
      message: expect.stringContaining('INVALID_RETURN_URL'),
    });
    await expect(startVippsLogin({ returnUrl: 'http://evil.example' })).rejects.toBeInstanceOf(
      PortalValidationError
    );
  });

  it('turns 429 into PortalThrottledError', async () => {
    failed(429, 'RATE_LIMITED');

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(
      PortalThrottledError
    );
  });

  it('rethrows anything else as a MedalApiError with the status and code', async () => {
    failed(502, 'UPSTREAM_ERROR');

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('maps by code, not status: a 503 or 400 with another code is the generic error', async () => {
    failed(503, 'UPSTREAM_ERROR');
    const e503 = startVippsLogin({ returnUrl: RETURN_URL });
    await expect(e503).rejects.not.toBeInstanceOf(PortalVippsUnavailableError);
    await expect(e503).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_ERROR' });

    failed(400, 'VALIDATION_ERROR');
    const e400 = startVippsLogin({ returnUrl: RETURN_URL });
    await expect(e400).rejects.not.toBeInstanceOf(PortalValidationError);
    await expect(e400).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('files an error body without a code as UNKNOWN_ERROR', async () => {
    stubFetch({ error: 'vipps_not_configured' }, 503);

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toMatchObject({
      status: 503,
      code: 'UNKNOWN_ERROR',
    });
  });

  it('refuses an authorize URL that is not https, and a body without one', async () => {
    ok({ authorize_url: 'javascript:alert(1)' });
    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(MedalApiError);

    ok({ something: 'else' });
    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(MedalApiError);
  });

  it('treats a legacy bare body without `data` as a failure, not a success', async () => {
    stubFetch({ authorize_url: 'https://api.vipps.no/authorize?x=1' });
    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(MedalApiError);

    stubFetch(null);
    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(MedalApiError);
  });

  it('refuses to run without an API key rather than calling Medal anonymously', async () => {
    vi.stubEnv('MEDAL_API_KEY', '');
    const fetchMock = ok({ authorize_url: 'https://api.vipps.no/authorize' });

    await expect(startVippsLogin({ returnUrl: RETURN_URL })).rejects.toBeInstanceOf(
      MedalConfigError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('exchangeVippsGrant', () => {
  it("posts the grant and hands back the token and expiry in the seam's own shape", async () => {
    const fetchMock = ok({ session_token: TOKEN, expires_at: 1234, contact: { id: 'x' } });

    await expect(exchangeVippsGrant(GRANT)).resolves.toEqual({
      sessionToken: TOKEN,
      expiresAt: 1234,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://medal.test/api/v1/portal/vipps/exchange');
    expect(init.method).toBe('POST');
    expect(header(init, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ grant: GRANT });
  });

  it('answers null — not an error — to 404 GRANT_NOT_FOUND', async () => {
    failed(404, 'GRANT_NOT_FOUND', 'No such grant');

    await expect(exchangeVippsGrant(GRANT)).resolves.toBeNull();
  });

  it('does not read any other 404 as an unknown grant', async () => {
    failed(404, 'NOT_FOUND', 'No such route');

    await expect(exchangeVippsGrant(GRANT)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('spends the grant exactly once — a 503 is not retried into GRANT_NOT_FOUND', async () => {
    const fetchMock = failed(503, 'UNAVAILABLE');
    await expect(exchangeVippsGrant(GRANT)).rejects.toBeInstanceOf(MedalApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns 429 into PortalThrottledError', async () => {
    failed(429, 'RATE_LIMITED');

    await expect(exchangeVippsGrant(GRANT)).rejects.toBeInstanceOf(PortalThrottledError);
  });

  it('rethrows anything else', async () => {
    failed(502, 'UPSTREAM_ERROR');

    await expect(exchangeVippsGrant(GRANT)).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('refuses a 200 without a token or expiry instead of returning half a session', async () => {
    ok({ session_token: TOKEN });

    await expect(exchangeVippsGrant(GRANT)).rejects.toBeInstanceOf(MedalApiError);
  });

  it('treats a legacy bare body without `data` as a failure, not a session', async () => {
    stubFetch({ session_token: TOKEN, expires_at: 1234 });

    await expect(exchangeVippsGrant(GRANT)).rejects.toBeInstanceOf(MedalApiError);
  });
});

describe('secret redaction', () => {
  async function thrownBy(run: () => Promise<unknown>): Promise<Error> {
    try {
      await run();
    } catch (error) {
      return error as Error;
    }
    throw new Error('expected a throw');
  }

  function everyString(error: Error): string {
    const cause = error.cause;
    const causeText =
      cause instanceof Error ? everyString(cause) : typeof cause === 'string' ? cause : '';
    return [error.message, error.stack ?? '', causeText].join('\n');
  }

  it('scrubs the grant and the API key out of a fetch failure and its cause chain', async () => {
    const root = new Error(`connect failed sending {"grant":"${GRANT}"} with Bearer ${API_KEY}`);
    const failure = new TypeError(`fetch failed for grant ${GRANT}`, { cause: root });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    const error = await thrownBy(() => exchangeVippsGrant(GRANT));

    // Exchange goes through the SDK, which wraps a transport failure in
    // `MedalNetworkError` with the original as its `cause`; the scrub follows
    // the chain down to the root.
    expect(error).toBeInstanceOf(MedalNetworkError);
    expect(error.cause).toBe(failure);
    const text = everyString(error);
    expect(text).not.toContain(GRANT);
    expect(text).not.toContain(API_KEY);
    expect(failure.message).toBe('fetch failed for grant <grant>');
    expect((failure.cause as Error).message).toContain('<key>');
  });

  it('scrubs the token out of an error thrown after Medal has already handed it over', async () => {
    // A body that carries the token but not a usable expiry: the seam throws,
    // and by then it KNOWS the token. Neither the message nor a stack frame
    // that quotes the body may carry it.
    ok({ session_token: TOKEN, expires_at: `${TOKEN}` });

    const error = await thrownBy(() => exchangeVippsGrant(GRANT));

    const text = everyString(error);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(GRANT);
  });

  it('scrubs the API key out of a failed start too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error(`refused: Authorization: Bearer ${API_KEY}`))
    );

    const error = await thrownBy(() => startVippsLogin({ returnUrl: RETURN_URL }));

    expect(everyString(error)).not.toContain(API_KEY);
    expect(error.message).toBe('refused: Authorization: Bearer <key>');
  });

  it('keeps a redacted MedalApiError as the same instance, status and code', async () => {
    stubFetch({ error: { code: `GRANT_GONE_${GRANT}`, message: `grant ${GRANT} is gone` } }, 410);

    const error = await thrownBy(() => exchangeVippsGrant(GRANT));

    expect(error).toBeInstanceOf(MedalApiError);
    expect((error as MedalApiError).status).toBe(410);
    expect(error.message).not.toContain(GRANT);
  });
});

describe('verifyVippsLink (SP10)', () => {
  const LINK = ['link', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');
  const BINDING = ['bind', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');

  it('posts the link, the code and the binding, and answers with the session', async () => {
    const fetchMock = ok({ session_token: TOKEN, expires_at: 1234 });

    await expect(
      verifyVippsLink({ link: LINK, code: '492155', browserBinding: BINDING })
    ).resolves.toEqual({ sessionToken: TOKEN, expiresAt: 1234 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://medal.test/api/v1/portal/vipps/link/verify');
    expect(init.method).toBe('POST');
    expect(header(init, 'authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({
      link: LINK,
      code: '492155',
      browser_binding: BINDING,
    });
  });

  it('is `null` for every refusal Medal folds into PORTAL_CODE_INVALID', async () => {
    failed(401, 'PORTAL_CODE_INVALID');
    await expect(
      verifyVippsLink({ link: LINK, code: '000000', browserBinding: BINDING })
    ).resolves.toBeNull();
  });

  it('maps the identity conflict and the throttle', async () => {
    failed(409, 'VIPPS_IDENTITY_CONFLICT');
    await expect(
      verifyVippsLink({ link: LINK, code: '492155', browserBinding: BINDING })
    ).rejects.toBeInstanceOf(PortalVippsConflictError);

    failed(429, 'RATE_LIMITED');
    await expect(
      verifyVippsLink({ link: LINK, code: '492155', browserBinding: BINDING })
    ).rejects.toBeInstanceOf(PortalThrottledError);
  });

  it('keeps the link, the binding and the token out of anything it throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`failed ${LINK} ${BINDING} ${API_KEY}`);
      })
    );

    const error = (await verifyVippsLink({
      link: LINK,
      code: '492155',
      browserBinding: BINDING,
    }).catch((thrown: unknown) => thrown)) as Error;

    for (const secret of [LINK, BINDING, API_KEY]) {
      expect(String(error.message)).not.toContain(secret);
      expect(String(error.stack)).not.toContain(secret);
    }
  });

  it('sends the code exactly once — a 503 is not retried into PORTAL_CODE_INVALID', async () => {
    const fetchMock = failed(503, 'UNAVAILABLE');
    await expect(
      verifyVippsLink({ link: LINK, code: '492155', browserBinding: BINDING })
    ).rejects.toBeInstanceOf(MedalApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a 200 without a session as a failure', async () => {
    ok({ expires_at: 1 });
    await expect(
      verifyVippsLink({ link: LINK, code: '492155', browserBinding: BINDING })
    ).rejects.toThrow(/malformed/);
  });
});

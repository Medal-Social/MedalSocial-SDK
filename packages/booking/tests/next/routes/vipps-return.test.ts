import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalThrottledError } from '../../../src/next/portal/medal-portal';
import { vippsReturnRoute } from '../../../src/next/routes/vipps-return';
import { testLogger, testRuntime } from '../../support/next-runtime';

/**
 * `GET /min-side/vipps` — where Vipps sends the parent back, and the one
 * place a grant becomes a `demo_portal` cookie. This file pins the branch
 * table: which query the handler saw, where it sends the parent, and — the
 * assertion this file exists for — that the cookie is written on exactly one
 * of those branches. It also checks that nothing the handler was handed in
 * the query ever comes back out in a body or a `Location`.
 */

const writePortalSession = vi.fn();
const takePortalNextPath = vi.fn();
const writePendingLink = vi.fn();
const readBrowserBinding = vi.fn();
const clearBrowserBinding = vi.fn();
const exchangeVippsGrant = vi.fn();

const rt = testRuntime(
  {
    session: { writePortalSession } as never,
    nextPath: { takePortalNextPath } as never,
    vippsLink: { writePendingLink, readBrowserBinding, clearBrowserBinding } as never,
    portal: { exchangeVippsGrant } as never,
  },
  { logger: testLogger() }
);
const GET = (request: Request) => vippsReturnRoute(rt, request);

const ORIGIN = 'https://salong.example';
const GRANT = 'grant-opaque-value-1234567890';
// Built, not written out: a 43-char base64url literal reads as a leaked credential to
// secret scanners (DeepSource), and this one is synthetic.
const TOKEN = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

function get(query: string, origin = ORIGIN) {
  return GET(new Request(`${origin}/min-side/vipps${query}`));
}

async function expectRedirect(response: Response, path: string, origin = ORIGIN) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`${origin}${path}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeVippsGrant).mockResolvedValue({ sessionToken: TOKEN, expiresAt: 1234 });
  vi.mocked(writePortalSession).mockResolvedValue(undefined);
  // The default is «this login started on Min side», which is every case in
  // the branch table below; the login-prefill tests set their own.
  vi.mocked(takePortalNextPath).mockResolvedValue(null);
  // This browser started the login: it holds the binding.
  vi.mocked(readBrowserBinding).mockResolvedValue('binding');
});

describe('GET /min-side/vipps', () => {
  it('exchanges a grant, writes the cookie and sends the parent to /min-side', async () => {
    const response = await get(`?grant=${GRANT}`);

    expect(exchangeVippsGrant).toHaveBeenCalledWith(GRANT);
    expect(writePortalSession).toHaveBeenCalledTimes(1);
    expect(writePortalSession).toHaveBeenCalledWith(TOKEN, 1234);
    await expectRedirect(response, '/min-side');
  });

  it('builds the Location from the origin it was asked on', async () => {
    const response = await get(`?grant=${GRANT}`, 'http://localhost:3000');

    await expectRedirect(response, '/min-side', 'http://localhost:3000');
  });

  it('writes NO cookie for a grant Medal refuses, and says «failed»', async () => {
    vi.mocked(exchangeVippsGrant).mockResolvedValue(null);

    const response = await get(`?grant=${GRANT}`);

    expect(writePortalSession).not.toHaveBeenCalled();
    await expectRedirect(response, '/min-side/logg-inn?vipps=failed');
  });

  it.each([
    ['Medal is throttling', new PortalThrottledError()],
    ['Medal cannot be reached', new TypeError('fetch failed')],
  ])('writes NO cookie and says «failed» when %s', async (_label, error) => {
    // The parent has just said yes at Vipps; an error page would be the
    // worst place to leave them. The login page with its e-mail form is not.
    vi.mocked(exchangeVippsGrant).mockRejectedValue(error);

    const response = await get('https://salong.example/min-side/vipps?grant=g_1');

    expect(writePortalSession).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://salong.example/min-side/logg-inn?vipps=failed'
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not redirect when the cookie could not be written', async () => {
    vi.mocked(writePortalSession).mockRejectedValue(new Error('jar unavailable'));

    await expect(get(`?grant=${GRANT}`)).rejects.toThrow('jar unavailable');
  });

  it('sends a cancelled login back to the login with no message', async () => {
    const response = await get('?vipps=cancelled');

    expect(exchangeVippsGrant).not.toHaveBeenCalled();
    expect(writePortalSession).not.toHaveBeenCalled();
    await expectRedirect(response, '/min-side/logg-inn');
  });

  it('forwards «needs_email_login» to the login page', async () => {
    const response = await get('?vipps=needs_email_login');

    expect(writePortalSession).not.toHaveBeenCalled();
    await expectRedirect(response, '/min-side/logg-inn?vipps=needs_email_login');
  });

  it.each(['?vipps=failed', '', '?vipps=', '?grant=', '?other=1'])(
    'treats %j as a failed login',
    async (query) => {
      const response = await get(query);

      expect(exchangeVippsGrant).not.toHaveBeenCalled();
      expect(writePortalSession).not.toHaveBeenCalled();
      await expectRedirect(response, '/min-side/logg-inn?vipps=failed');
    }
  );

  it('never echoes a query value into the response', async () => {
    const response = await get('?vipps=%3Cscript%3Ealert(1)%3C%2Fscript%3E&grant=');

    expect(writePortalSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/min-side/logg-inn?vipps=failed`);
    expect(response.headers.get('location')).not.toContain('script');
    expect(await response.text()).toBe('');
  });
});

/**
 * A login that started somewhere other than Min side (D54): the barnehage
 * flow's «Hent fra Vipps», which stores where the parent should land in a
 * read-once cookie before sending them off.
 */
describe('GET /min-side/vipps — a login that started in the barnehage flow', () => {
  const FLOW = '/barnehage/eksempel?fortsett=1';

  beforeEach(() => {
    vi.mocked(takePortalNextPath).mockResolvedValue(FLOW);
  });

  it('sends a successful login back to the flow instead of to /min-side', async () => {
    const response = await get(`?grant=${GRANT}`);
    await expectRedirect(response, FLOW);
    expect(writePortalSession).toHaveBeenCalledOnce();
  });

  /** The parent's half-filled registration is still in the tab behind them;
   * Min side's login page has nothing to offer it. */
  it('sends a cancelled login back to the flow too, with no cookie written', async () => {
    await expectRedirect(await get('?vipps=cancelled'), FLOW);
    expect(writePortalSession).not.toHaveBeenCalled();
  });

  it('sends a refused grant back to the flow, with no cookie written', async () => {
    vi.mocked(exchangeVippsGrant).mockResolvedValue(null);
    await expectRedirect(await get(`?grant=${GRANT}`), FLOW);
    expect(writePortalSession).not.toHaveBeenCalled();
  });

  it('sends a failed exchange back to the flow', async () => {
    vi.mocked(exchangeVippsGrant).mockRejectedValue(new PortalThrottledError());
    await expectRedirect(await get(`?grant=${GRANT}`), FLOW);
    expect(writePortalSession).not.toHaveBeenCalled();
  });

  /** Read once, on every branch: a destination that outlived one attempt would
   * capture the next login too. */
  it('takes the destination exactly once, whatever the outcome', async () => {
    await get('?vipps=cancelled');
    expect(takePortalNextPath).toHaveBeenCalledOnce();
  });
});

/**
 * SP10: Medal could not match the Vipps login to one profile and e-mailed the
 * address on file a code. The link goes into an httpOnly cookie, never into
 * the URL the parent lands on.
 */
describe('GET /min-side/vipps?vipps=confirm_email', () => {
  const LINK = ['link', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');
  const TO = 'k•••@g•••.com';

  it('keeps the link in the cookie and sends the parent to the login’s code step', async () => {
    const response = await get(`?vipps=confirm_email&link=${LINK}&to=${encodeURIComponent(TO)}`);

    expect(writePendingLink).toHaveBeenCalledWith(LINK);
    expect(writePortalSession).not.toHaveBeenCalled();
    await expectRedirect(
      response,
      `/min-side/logg-inn?vipps=confirm_email&to=${encodeURIComponent(TO)}`
    );
    expect(response.headers.get('location')).not.toContain(LINK);
  });

  it('goes back where the login started, keeping that page’s own query', async () => {
    vi.mocked(takePortalNextPath).mockResolvedValue('/bestill?resume=1&kategori=barn');

    const response = await get(`?vipps=confirm_email&link=${LINK}`);

    // No `to` from Medal (the contact was found by phone): no `to` onwards.
    await expectRedirect(response, '/bestill?resume=1&kategori=barn&vipps=confirm_email');
  });

  it('drops a `to` that is not the masked shape, rather than carrying it on', async () => {
    const response = await get(
      `?vipps=confirm_email&link=${LINK}&to=${encodeURIComponent('<b>kari@example.com</b>')}`
    );

    await expectRedirect(response, '/min-side/logg-inn?vipps=confirm_email');
  });

  it('writes no link cookie without a binding cookie — Medal would refuse any code', async () => {
    vi.mocked(readBrowserBinding).mockResolvedValue(null);

    const response = await get(`?vipps=confirm_email&link=${LINK}`);

    expect(writePendingLink).not.toHaveBeenCalled();
    await expectRedirect(response, '/min-side/logg-inn?vipps=failed');
  });

  it('spends the binding on a grant, which needs no pending link', async () => {
    await get(`?grant=${GRANT}`);
    expect(clearBrowserBinding).toHaveBeenCalledTimes(1);
  });

  it('is a failed login, and writes nothing, for a link that is not the shape Medal mints', async () => {
    const response = await get('?vipps=confirm_email&link=short');

    expect(writePendingLink).not.toHaveBeenCalled();
    await expectRedirect(response, '/min-side/logg-inn?vipps=failed');
  });
});

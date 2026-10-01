import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PortalSessionExpiredError,
  PortalThrottledError,
} from '../../../src/next/portal/medal-portal';
import { vippsLinkReturnRoute } from '../../../src/next/routes/vipps-return';
import { testLogger, testRuntime } from '../../support/next-runtime';

/**
 * `GET /min-side/vipps/koble` — where Vipps, via Medal, sends a LOGGED-IN
 * parent back from «Koble til Vipps» on Profil. The branch table: every
 * answer a 303 to a bare `/min-side` with `no-referrer`; the outcome only in
 * an httpOnly flash, `linked` only from a grant Medal accepted; the binding
 * spent on any answer Medal gives about a `link_grant`; bare markers trusted
 * for nothing but a sentence.
 */

/** The site's own switch (`options.portal.enabled`), read per request. */
const getBookingPolicy = vi.fn();
const logger = testLogger();
const readPortalSession = vi.fn();
const clearPortalSession = vi.fn();
const readBrowserBinding = vi.fn();
const clearBrowserBinding = vi.fn();
const writeVippsLinkFlash = vi.fn();
const completeVippsLink = vi.fn();

const rt = testRuntime(
  {
    session: { readPortalSession, clearPortalSession } as never,
    vippsLink: { readBrowserBinding, clearBrowserBinding } as never,
    flash: { writeVippsLinkFlash } as never,
    portal: { completeVippsLink } as never,
  },
  {
    logger,
    portal: {
      enabled: async () => (await getBookingPolicy()).accountEnabled,
      vippsLinkReturnPath: '/min-side/vipps/koble',
    },
  }
);
const GET = (request: Request) => vippsLinkReturnRoute(rt, request);

const ORIGIN = 'https://salong.example';
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const BINDING = 'b'.repeat(43);
/** 43 characters of base64url — the shape Medal mints. Built, not a literal (secret scanners). */
const GRANT = ['g'.repeat(20), 'H'.repeat(20), '-_9'].join('');

function get(query: string) {
  return GET(new Request(`${ORIGIN}/min-side/vipps/koble${query}`));
}

async function expectRedirect(response: Response, path: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`${ORIGIN}${path}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await response.text()).toBe('');
}

/** Every return lands on the BARE dashboard: no grant, no outcome, no query. */
const HOME = '/min-side';

/** The grant under the key Medal uses for a profile link (#5592). */
const withGrant = (grant = GRANT) => `?link_grant=${grant}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBookingPolicy).mockResolvedValue({ accountEnabled: true } as Awaited<
    ReturnType<typeof getBookingPolicy>
  >);
  vi.mocked(readPortalSession).mockResolvedValue(SESSION);
  vi.mocked(readBrowserBinding).mockResolvedValue(BINDING);
  vi.mocked(completeVippsLink).mockResolvedValue('linked');
});

describe('GET /min-side/vipps/koble', () => {
  it('sends the parent home when Min side is switched off', async () => {
    vi.mocked(getBookingPolicy).mockResolvedValue({ accountEnabled: false } as Awaited<
      ReturnType<typeof getBookingPolicy>
    >);

    await expectRedirect(await get(withGrant()), '/');
    expect(completeVippsLink).not.toHaveBeenCalled();
  });

  it('spends a link grant with the session and binding, flashes «linked», and leaves no query', async () => {
    const response = await get(withGrant());

    expect(completeVippsLink).toHaveBeenCalledWith(SESSION, {
      grant: GRANT,
      browserBinding: BINDING,
    });
    expect(clearBrowserBinding).toHaveBeenCalledTimes(1);
    expect(writeVippsLinkFlash).toHaveBeenCalledWith('linked');
    await expectRedirect(response, HOME);
    expect(response.headers.get('location')).not.toContain(GRANT);
  });

  it('spends the binding on every answer Medal gives about the grant — 404 burns it too', async () => {
    vi.mocked(completeVippsLink).mockResolvedValue('conflict');
    await expectRedirect(await get(withGrant()), HOME);
    expect(writeVippsLinkFlash).toHaveBeenLastCalledWith('link_conflict');

    vi.mocked(completeVippsLink).mockResolvedValue('invalid');
    await expectRedirect(await get(withGrant()), HOME);
    expect(writeVippsLinkFlash).toHaveBeenLastCalledWith('link_failed');

    expect(clearBrowserBinding).toHaveBeenCalledTimes(2);
    expect(writeVippsLinkFlash).not.toHaveBeenCalledWith('linked');
  });

  it('keeps the binding when Medal gave no answer about the grant', async () => {
    vi.mocked(completeVippsLink).mockRejectedValue(new PortalThrottledError());
    await expectRedirect(await get(withGrant()), HOME);
    expect(logger.error).not.toHaveBeenCalled();

    vi.mocked(completeVippsLink).mockRejectedValue(new Error('down'));
    await expectRedirect(await get(withGrant()), HOME);
    expect(logger.error).toHaveBeenCalledTimes(1);

    expect(clearBrowserBinding).not.toHaveBeenCalled();
    expect(writeVippsLinkFlash).toHaveBeenCalledTimes(2);
    expect(writeVippsLinkFlash).toHaveBeenLastCalledWith('link_failed');
  });

  it('trusts no bare marker: a forged «linked» says nothing, and none keeps the binding from expiring', async () => {
    await expectRedirect(await get('?vipps=linked'), HOME);
    await expectRedirect(await get('?vipps=cancelled'), HOME);
    expect(writeVippsLinkFlash).not.toHaveBeenCalled();

    await expectRedirect(await get('?vipps=link_conflict'), HOME);
    expect(writeVippsLinkFlash).toHaveBeenLastCalledWith('link_conflict');
    await expectRedirect(await get('?vipps=failed'), HOME);
    await expectRedirect(await get(''), HOME);
    await expectRedirect(await get('?vipps=<script>'), HOME);
    expect(writeVippsLinkFlash).toHaveBeenLastCalledWith('link_failed');

    expect(writeVippsLinkFlash).not.toHaveBeenCalledWith('linked');
    expect(completeVippsLink).not.toHaveBeenCalled();
    expect(clearBrowserBinding).not.toHaveBeenCalled();
  });

  it("takes only `link_grant`: the login return's `?grant=` is not a link grant", async () => {
    await expectRedirect(await get(`?grant=${GRANT}`), HOME);

    expect(completeVippsLink).not.toHaveBeenCalled();
    expect(writeVippsLinkFlash).toHaveBeenCalledWith('link_failed');
  });

  it('asks Medal nothing, and keeps the binding, without one or for a malformed grant', async () => {
    vi.mocked(readBrowserBinding).mockResolvedValue(null);
    await expectRedirect(await get(withGrant()), HOME);

    vi.mocked(readBrowserBinding).mockResolvedValue(BINDING);
    await expectRedirect(await get('?link_grant=has%20spaces'), HOME);
    // Not 43 characters: not a grant Medal minted.
    await expectRedirect(await get(withGrant(`${GRANT}x`)), HOME);
    await expectRedirect(await get(`${withGrant()}&link_grant=${GRANT}`), HOME);

    expect(completeVippsLink).not.toHaveBeenCalled();
    expect(clearBrowserBinding).not.toHaveBeenCalled();
  });

  it('sends a parent with no session to the login, binding untouched', async () => {
    vi.mocked(readPortalSession).mockResolvedValue(null);

    await expectRedirect(await get(withGrant()), '/min-side/logg-inn');
    expect(completeVippsLink).not.toHaveBeenCalled();
    expect(clearBrowserBinding).not.toHaveBeenCalled();
  });

  it('clears a session Medal no longer honours (a staff unlink ends them all) and goes to the login', async () => {
    vi.mocked(completeVippsLink).mockRejectedValue(new PortalSessionExpiredError());

    await expectRedirect(await get(withGrant()), '/min-side/logg-inn');
    expect(clearPortalSession).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(writeVippsLinkFlash).not.toHaveBeenCalled();
  });
});

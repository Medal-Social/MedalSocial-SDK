import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalSessionExpiredError } from '../../../src/next/portal/medal-portal';
import { sessionExpiredRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `GET /api/portal/session/expired` — the one place a dead `demo_portal` cookie
 * is cleared on a page load. `/min-side` cannot do it while rendering (Next
 * forbids cookie writes outside an action or a route handler), so it redirects
 * here; this file checks that the handler does both halves of the job — drops
 * the cookie AND forwards to the login — does it in a way no cache can replay,
 * and clears NOTHING Medal still honours, so a stranger's link to this
 * predictable URL cannot log a parent out.
 */

const readPortalSession = vi.fn();
const clearPortalSession = vi.fn();
const getMe = vi.fn();

const rt = testRuntime({
  session: { readPortalSession, clearPortalSession } as never,
  portal: { getMe } as never,
});
const GET = (request: Request) => sessionExpiredRoute(rt, request);

const SESSION = 'a'.repeat(43);

function get(origin = 'https://salong.example') {
  return GET(new Request(`${origin}/api/portal/session/expired`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readPortalSession).mockResolvedValue(SESSION);
  vi.mocked(getMe).mockRejectedValue(new PortalSessionExpiredError());
  vi.mocked(clearPortalSession).mockResolvedValue(undefined);
});

describe('GET /api/portal/session/expired', () => {
  it('clears a cookie Medal refuses and answers 303 to the login', async () => {
    const response = await get();

    expect(getMe).toHaveBeenCalledWith(SESSION);
    expect(clearPortalSession).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://salong.example/min-side/logg-inn');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('builds the Location from the origin it was asked on', async () => {
    const response = await get('http://localhost:3000');

    expect(response.headers.get('location')).toBe('http://localhost:3000/min-side/logg-inn');
  });

  it("leaves a session Medal still honours alone — a stranger's link logs nobody out", async () => {
    vi.mocked(getMe).mockResolvedValue({} as never);

    const response = await get();

    expect(clearPortalSession).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://salong.example/min-side');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the cookie when Medal cannot be asked, and lets /min-side say so', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('fetch failed'));

    const response = await get();

    expect(clearPortalSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://salong.example/min-side');
  });

  it('sends a visitor without a cookie to the login without asking Medal', async () => {
    vi.mocked(readPortalSession).mockResolvedValue(null);

    const response = await get();

    expect(getMe).not.toHaveBeenCalled();
    expect(clearPortalSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://salong.example/min-side/logg-inn');
  });

  it('does not redirect when the cookie could not be cleared', async () => {
    // A redirect with the cookie still in the jar is the loop this route
    // exists to prevent; better a 500 the parent can reload than a bounce.
    vi.mocked(clearPortalSession).mockRejectedValue(new Error('jar unavailable'));

    await expect(get()).rejects.toThrow('jar unavailable');
  });
});

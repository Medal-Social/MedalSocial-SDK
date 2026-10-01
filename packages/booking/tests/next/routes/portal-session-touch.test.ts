import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalSessionExpiredError } from '../../../src/next/portal/medal-portal';
import { sessionTouchRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `POST /api/portal/session/touch` — how a Min side page load keeps the
 * cookie as long-lived as the session Medal keeps sliding. A page cannot set
 * cookies while rendering, so the dashboard calls this once an hour at most.
 *
 * It asks Medal (`getMe`) and rewrites the cookie ONLY when Medal answered;
 * a dead session is a 401 and changes nothing — `/min-side`'s own
 * verify-then-clear flow deals with it — and a Medal failure renews nothing.
 */

const readPortalSession = vi.fn();
const renewPortalSession = vi.fn();
const clearPortalSession = vi.fn();
const getMe = vi.fn();

const rt = testRuntime({
  session: { readPortalSession, renewPortalSession, clearPortalSession } as never,
  portal: { getMe } as never,
});
const POST = () => sessionTouchRoute(rt);

const SESSION = 'a'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readPortalSession).mockResolvedValue(SESSION);
  vi.mocked(getMe).mockResolvedValue({} as never);
});

describe('POST /api/portal/session/touch', () => {
  it('renews the cookie and answers 204 when Medal accepts the session', async () => {
    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getMe).toHaveBeenCalledWith(SESSION);
    expect(renewPortalSession).toHaveBeenCalledWith(SESSION);
    expect(await response.text()).toBe('');
  });

  it('answers 401 and asks nobody when there is no session cookie', async () => {
    vi.mocked(readPortalSession).mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(getMe).not.toHaveBeenCalled();
    expect(renewPortalSession).not.toHaveBeenCalled();
  });

  it('answers 401 for a dead session and neither renews nor clears it', async () => {
    vi.mocked(getMe).mockRejectedValue(new PortalSessionExpiredError());

    const response = await POST();

    expect(response.status).toBe(401);
    expect(renewPortalSession).not.toHaveBeenCalled();
    expect(clearPortalSession).not.toHaveBeenCalled();
  });

  it('answers 503 and renews nothing when Medal cannot be asked', async () => {
    vi.mocked(getMe).mockRejectedValue(new Error('upstream 502'));

    const response = await POST();

    expect(response.status).toBe(503);
    expect(renewPortalSession).not.toHaveBeenCalled();
    expect(await response.text()).toBe('');
  });
});

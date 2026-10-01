/**
 * The portal's session cookie — and, on the site side, the whole security
 * boundary of the customer portal.
 *
 * What the cookie holds is an OPAQUE session token that Medal minted when the
 * parent proved they owned their phone number or e-mail address. It is a
 * bearer credential for one contact: whoever presents it to Medal is that
 * parent, and sees every booking, every child and every manage link they
 * have. The site never decodes it, never derives anything from it, and never
 * stores it anywhere but here. Three rules follow, and every route that
 * touches the portal is written to keep them:
 *
 * 1. **It never reaches the browser's JavaScript.** `httpOnly`, always, and
 *    the value is never echoed into a prop, a `data-` attribute, a URL or a
 *    JSON body — the pages that need it read it here on the server and forward
 *    it to Medal in a header.
 * 2. **It is never logged.** Not on a warning, not on a 502, not on a failed
 *    read. A log line is copied to places a cookie is not.
 * 3. **It is never forwarded unread.** `readPortalSession` hands back a value
 *    only when it has the exact shape Medal issues, so a tampered, truncated
 *    or foreign cookie under the same name is a `null` rather than a request
 *    to Medal carrying attacker-chosen bytes in an `Authorization` header.
 *
 * The cookie's name is `config.portal.cookieName`, so a site moving onto the
 * package keeps its existing sessions.
 */

import type { BookingConfig } from '../../core/config';
import type { CookieSource } from '../../core/portal/cookies';
import { isPortalSessionToken } from '../../core/portal/session-cookie';

/**
 * How long a session Medal has just accepted is still good for, at least.
 *
 * Medal slides portal sessions on use: when the session was last seen more
 * than the touch interval (≈ 1 h) ago, it sets `expiresAt = now + 30 days`.
 * So right after any call it answered, the session expires no earlier than
 * now + 30 d − 1 h. The SDK does not return that expiry, so the site writes
 * the floor.
 */
const MEDAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEDAL_SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const RENEWED_SESSION_LIFETIME_MS = MEDAL_SESSION_TTL_MS - MEDAL_SESSION_TOUCH_INTERVAL_MS;

export interface PortalSession {
  readonly PORTAL_SESSION_COOKIE: string;
  /**
   * The session token the request carries, or `null` — for no cookie, a
   * cookie that is not the shape Medal issues, and an empty one alike. A
   * caller has one decision to make about any of them: treat the visitor as
   * logged out.
   */
  readPortalSession(): Promise<string | null>;
  /**
   * Store a freshly issued session token for the life of the session
   * (`expiresAt`, Medal's own expiry in epoch milliseconds).
   *
   * `httpOnly`; `secure` unconditionally (browsers treat `localhost` as a
   * secure context); `sameSite: 'lax'` because the parent arrives from a
   * link in an e-mail or SMS — a top-level cross-site navigation `strict`
   * would withhold the cookie on; `path: '/'`. A malformed token is a
   * programming error and is thrown rather than stored.
   */
  writePortalSession(token: string, expiresAt: number): Promise<void>;
  /**
   * Rewrite the cookie after Medal accepted `token`, so an active parent is
   * not logged out 30 days after their FIRST login. Only after a call that
   * SUCCEEDED with this token.
   */
  renewPortalSession(token: string, now?: number): Promise<void>;
  /**
   * Log the parent out on this browser — only the cookie; revoking the
   * session upstream is the caller's job, done BEFORE this. The path is
   * spelled out because the browser matches an expiring cookie on name AND
   * path.
   */
  clearPortalSession(): Promise<void>;
}

export function createPortalSession(
  config: Pick<BookingConfig, 'portal'>,
  cookies: CookieSource
): PortalSession {
  const PORTAL_SESSION_COOKIE = config.portal.cookieName;

  async function readPortalSession(): Promise<string | null> {
    const jar = await cookies();
    const value = jar.get(PORTAL_SESSION_COOKIE)?.value;
    return isPortalSessionToken(value) ? value : null;
  }

  async function writePortalSession(token: string, expiresAt: number): Promise<void> {
    if (!isPortalSessionToken(token)) {
      throw new Error('invalid portal session token');
    }
    const jar = await cookies();
    jar.set(PORTAL_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt),
    });
  }

  async function renewPortalSession(token: string, now: number = Date.now()): Promise<void> {
    await writePortalSession(token, now + RENEWED_SESSION_LIFETIME_MS);
  }

  async function clearPortalSession(): Promise<void> {
    const jar = await cookies();
    jar.delete({ name: PORTAL_SESSION_COOKIE, path: '/' });
  }

  return {
    PORTAL_SESSION_COOKIE,
    readPortalSession,
    writePortalSession,
    renewPortalSession,
    clearPortalSession,
  };
}

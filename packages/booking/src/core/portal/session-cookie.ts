/**
 * The portal session cookie's *shape* — name and token alphabet — with no
 * Next.js `cookies()` import, so Edge middleware can share the check the
 * server reader uses without pulling `server-only` into the Worker.
 *
 * The token is a 43-character base64url string: 32 random bytes, encoded
 * without padding, which is what Medal's issuer produces and the one shape
 * this site accepts. The alphabet is `A–Z a–z 0–9 - _` — a `+`, `/` or `=`
 * is standard base64 and is refused, because a value that came from a
 * different encoder did not come from Medal.
 */

import type { BookingConfig } from '../config';

/** 32 bytes, base64url, no padding: `ceil(32 × 8 / 6)` = 43 characters. */
const PORTAL_SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a value is the shape of a Medal-issued portal session token.
 *
 * Shared by the cookie reader, the cookie writer, and middleware so the three
 * cannot disagree — a token the writer accepted but the reader (or the
 * bounce) refused would log the parent in and then out again on the next
 * request, with nothing on screen to say why.
 *
 * `unknown` rather than `string`, because the value on the way in is whatever
 * a JSON body or a cookie header contained, and narrowing it is this
 * function's whole job.
 */
export function isPortalSessionToken(value: unknown): value is string {
  return typeof value === 'string' && PORTAL_SESSION_TOKEN.test(value);
}

export interface SessionCookie {
  /** The session cookie's name (`portal.cookieName`). */
  readonly PORTAL_SESSION_COOKIE: string;
  /** Exact dashboard URL the middleware bounce matches (`paths.portal`). */
  readonly PORTAL_DASHBOARD_PATH: string | null;
  /** Where a logged-out dashboard visit is sent (`paths.portalLogin`). */
  readonly PORTAL_LOGIN_PATH: string;
  isPortalSessionToken: typeof isPortalSessionToken;
}

export function createSessionCookie(
  config: Pick<BookingConfig, 'portal' | 'paths'>
): SessionCookie {
  return {
    PORTAL_SESSION_COOKIE: config.portal.cookieName,
    PORTAL_DASHBOARD_PATH: config.paths.portal,
    PORTAL_LOGIN_PATH: config.paths.portalLogin,
    isPortalSessionToken,
  };
}

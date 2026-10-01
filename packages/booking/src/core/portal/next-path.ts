import type { BookingConfig } from '../config';
import type { CookieSource } from './cookies';
import { createReturnPath } from './return-path';

/**
 * Where to send the parent after a Vipps login that did not start on Min side.
 *
 * The e-mail login can carry its destination in the URL — the parent stays on
 * this site for the whole handshake, and `/min-side/logg-inn?return=…` is read
 * by the page that renders the form. The Vipps login cannot: the browser goes
 * to Medal, then to Vipps, then back to `/min-side/vipps`, and the only thing
 * this site controls along that path is the `return_url` it handed Medal at
 * the start. Two reasons not to put the destination in THAT:
 *
 * 1. Medal validates the `return_url` against the workspace's site and answers
 *    `400 INVALID_RETURN_URL` for one it does not recognise. A query string
 *    this site invents is a second thing that has to survive a check written
 *    on the other side of the integration — and the barnehage payment leg has
 *    already been bitten once by an engine that rewrote a `return_url`'s query
 *    (D31).
 * 2. It would put a redirect target in a URL a third party hands back to the
 *    browser, which is the shape an open redirect is usually built out of.
 *
 * So the destination never leaves this site: it goes into a short-lived
 * httpOnly cookie before the redirect to Vipps, and `/min-side/vipps` takes it
 * out again when the grant comes back. `sameSite: 'lax'` is what makes that
 * work — the return from Vipps is a top-level GET navigation, which is exactly
 * the case `lax` still sends a cookie on.
 *
 * VALIDATED ON BOTH SIDES. `safeReturnPath` runs before the value is written
 * AND after it is read, so a cookie edited in the jar between the two — this
 * one is httpOnly, but a cookie is not a promise — is a `null` rather than a
 * redirect of the holder's choosing.
 */

/**
 * Ten minutes: a Vipps login is a phone unlock and a confirmation, and a value
 * that outlived the attempt would send a parent who came back to the login on
 * their own into the middle of a flow they had left.
 */
const MAX_AGE_SECONDS = 10 * 60;

export interface PortalNextPath {
  readonly PORTAL_NEXT_COOKIE: string;
  writePortalNextPath(path: string | null): Promise<void>;
  takePortalNextPath(): Promise<string | null>;
}

/** The read-once «where this login ends» cookie (`portal.nextCookieName`). */
export function createPortalNextPath(
  config: Pick<BookingConfig, 'portal'>,
  cookies: CookieSource
): PortalNextPath {
  const PORTAL_NEXT_COOKIE = config.portal.nextCookieName;
  const safeReturnPath = createReturnPath(config);

  /**
   * Remember where this login should end, or forget any earlier answer.
   *
   * A `null` path CLEARS rather than leaves the previous value in place: a
   * parent who starts a barnehage login, abandons it and then logs in normally
   * from Min side must not be thrown into the kindergarten flow by a cookie the
   * first attempt left behind.
   *
   * `secure` unconditionally, matching `PORTAL_SESSION_COOKIE` — see
   * `lib/portal/session.ts` for why localhost still works in Chrome and Firefox.
   */
  async function writePortalNextPath(path: string | null): Promise<void> {
    const safe = path === null ? null : safeReturnPath(path);
    const jar = await cookies();
    if (safe === null) {
      jar.delete({ name: PORTAL_NEXT_COOKIE, path: '/' });
      return;
    }
    jar.set(PORTAL_NEXT_COOKIE, safe, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    });
  }

  /**
   * The remembered destination, and it is gone afterwards.
   *
   * Read-once on purpose: the value describes ONE login attempt, and leaving it
   * in the jar would redirect the next one too. The delete runs whether or not
   * the value survived validation, so a malformed cookie is not re-read on every
   * subsequent login either.
   */
  async function takePortalNextPath(): Promise<string | null> {
    const jar = await cookies();
    const raw = jar.get(PORTAL_NEXT_COOKIE)?.value;
    jar.delete({ name: PORTAL_NEXT_COOKIE, path: '/' });
    return safeReturnPath(raw);
  }

  return { PORTAL_NEXT_COOKIE, writePortalNextPath, takePortalNextPath };
}

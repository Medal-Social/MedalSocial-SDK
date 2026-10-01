/**
 * The two addresses Vipps (through Medal) sends a browser back to. Route
 * handlers and not pages: only an action or a route handler may write a
 * cookie, and a page cannot. They return NO body, so nothing a third party
 * wrote into the query string can be echoed into HTML, and the only thing
 * they do with a query value is compare it to a constant. Redirect targets
 * are built on the request's own origin.
 */

import { NextResponse } from 'next/server';
import { isVippsToken } from '../../core/portal/vipps-link';
import { maskedAddress, VIPPS_CONFIRM_QUERY } from '../../core/portal/vipps-return';
import { PortalSessionExpiredError, PortalThrottledError } from '../portal/medal-portal';
import type { VippsLinkFlash } from '../portal/vipps-flash';
import type { BookingRuntime } from '../runtime';

/** Whether the portal is on for this request (the site's switch, else the config). */
export async function portalEnabled(rt: BookingRuntime): Promise<boolean> {
  if (rt.paths.portal === null) return false;
  const enabled = rt.options.portal?.enabled;
  return enabled ? enabled() : rt.config.portal.enabled;
}

function seeOther(path: string, request: Request, headers: Record<string, string> = {}): Response {
  const location = new URL(path, request.url);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location.toString(), 'Cache-Control': 'no-store', ...headers },
  });
}

const VIPPS_LOGIN_QUERY = 'vipps';

/**
 * `GET <vippsReturnPath>` — where Vipps sends the parent back, and the one
 * place a Vipps grant becomes a session cookie.
 *
 * Medal lands the browser here with exactly one of: `?grant=<opaque>` (a
 * session is waiting), `?vipps=cancelled`, `?vipps=needs_email_login` (more
 * than one profile, log in with e-mail to pick one), `?vipps=confirm_email`
 * (one plausible profile, a code is on its way) or `?vipps=failed`.
 *
 * The cookie is written on ONE branch: a grant Medal accepted. A grant it
 * refused, or an exchange that could not be made at all, goes to the login
 * with `?vipps=failed` and the e-mail form; so does anything unrecognised.
 *
 * WHERE THE PARENT LANDS is the portal unless a login that started somewhere
 * else said otherwise; that destination travels in a read-once httpOnly
 * cookie (`core/portal/next-path.ts`), re-validated on the way out, and it is
 * taken on EVERY branch.
 */
export async function vippsReturnRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  // A route handler runs no layout, so the portal's gate is repeated here:
  // this is the one address under the account a third party can send a
  // browser to.
  if (!(await portalEnabled(rt))) return seeOther('/', request);
  const portalPath = rt.paths.portal as string;
  const login = rt.paths.portalLogin;
  const loginWith = (outcome: 'needs_email_login' | 'failed') =>
    `${login}?${VIPPS_LOGIN_QUERY}=${outcome}`;

  const { searchParams } = new URL(request.url);
  const grant = searchParams.get('grant');
  // Read once, before any branch returns: the value describes THIS attempt.
  const next = await rt.nextPath.takePortalNextPath();

  if (grant) {
    // A grant needs no pending link, so this attempt's binding is spent.
    await rt.vippsLink.clearBrowserBinding();
    let session: Awaited<ReturnType<BookingRuntime['portal']['exchangeVippsGrant']>>;
    try {
      session = await rt.portal.exchangeVippsGrant(grant);
    } catch (error) {
      rt.logger.error({ err: error }, 'Vipps grant could not be exchanged');
      return seeOther(next ?? loginWith('failed'), request);
    }
    if (session === null) return seeOther(next ?? loginWith('failed'), request);
    await rt.session.writePortalSession(session.sessionToken, session.expiresAt);
    return seeOther(next ?? portalPath, request);
  }

  // Medal found one plausible profile and e-mailed its address a code. The
  // link moves into an httpOnly cookie scoped to the route that spends it,
  // and the parent goes on with only the marker and the masked address.
  if (searchParams.get(VIPPS_LOGIN_QUERY) === VIPPS_CONFIRM_QUERY) {
    const link = searchParams.getAll('link');
    // No binding cookie means this browser did not start the login — or its
    // cookie expired — and Medal would refuse the code whatever was typed.
    if (
      link.length !== 1 ||
      !isVippsToken(link[0]) ||
      (await rt.vippsLink.readBrowserBinding()) === null
    ) {
      return seeOther(next ?? loginWith('failed'), request);
    }
    await rt.vippsLink.writePendingLink(link[0]);
    const target = new URL(next ?? login, request.url);
    target.searchParams.set(VIPPS_LOGIN_QUERY, VIPPS_CONFIRM_QUERY);
    const to = maskedAddress(searchParams.get('to'));
    if (to !== null) target.searchParams.set('to', to);
    return seeOther(`${target.pathname}${target.search}`, request);
  }

  // A login that started outside the portal goes back where it started,
  // whatever the outcome was.
  if (next !== null) return seeOther(next, request);

  switch (searchParams.get(VIPPS_LOGIN_QUERY)) {
    case 'cancelled':
      return seeOther(login, request);
    case 'needs_email_login':
      return seeOther(loginWith('needs_email_login'), request);
    default:
      return seeOther(loginWith('failed'), request);
  }
}

const GRANT_KEY = 'link_grant';
const MARKER_KEY = 'vipps';

/**
 * What a bare marker may say: a sentence at most. `linked` without a grant is
 * not proof of anything and says nothing; `cancelled` says nothing either.
 */
function markerFlash(value: string | null): VippsLinkFlash | null {
  if (value === 'linked' || value === 'cancelled') return null;
  if (value === 'link_conflict') return 'link_conflict';
  return 'link_failed';
}

/**
 * `GET <vippsLinkReturnPath>` — where Vipps, via Medal, sends a LOGGED-IN
 * parent back from «link Vipps» on the profile.
 *
 * `?link_grant=<43 chars>` is a one-time link grant this handler spends with
 * the parent's session and this browser's binding; `?vipps=link_conflict`,
 * `cancelled` or `failed` are bare markers.
 *
 * NOTHING IN THE QUERY IS TRUSTED AS AN OUTCOME, AND NOTHING STAYS IN IT.
 * Every answer is a 303 to a bare portal URL with `Referrer-Policy:
 * no-referrer`; the outcome travels as an httpOnly flash cookie, and `linked`
 * is written ONLY after Medal accepted a grant this handler exchanged.
 *
 * The binding is spent once Medal has answered about an exchanged grant. A
 * navigation without a grant, a malformed grant, a throttle or an outage
 * leave it to expire on its own. A session Medal no longer honours is cleared
 * here and the parent goes to the login.
 */
export async function vippsLinkReturnRoute(
  rt: BookingRuntime,
  request: Request
): Promise<Response> {
  const noReferrer = { 'Referrer-Policy': 'no-referrer' };
  if (!(await portalEnabled(rt))) return seeOther('/', request, noReferrer);
  const portalPath = rt.paths.portal as string;

  const session = await rt.session.readPortalSession();
  if (session === null) return seeOther(rt.paths.portalLogin, request, noReferrer);

  const landWith = async (flash: VippsLinkFlash | null) => {
    if (flash !== null) await rt.flash.writeVippsLinkFlash(flash);
    return seeOther(portalPath, request, noReferrer);
  };

  const { searchParams } = new URL(request.url);
  const grants = searchParams.getAll(GRANT_KEY);
  if (grants.length > 0) {
    const flash = await spendGrant(rt, session, grants);
    if (flash === 'session') return seeOther(rt.paths.portalLogin, request, noReferrer);
    return landWith(flash);
  }
  return landWith(markerFlash(searchParams.get(MARKER_KEY)));
}

/** Spend one well-formed grant with this browser's binding; what the profile should say. */
async function spendGrant(
  rt: BookingRuntime,
  session: string,
  grants: string[]
): Promise<VippsLinkFlash | 'session'> {
  const binding = await rt.vippsLink.readBrowserBinding();
  if (grants.length !== 1 || !isVippsToken(grants[0]) || binding === null) return 'link_failed';
  try {
    const outcome = await rt.portal.completeVippsLink(session, {
      grant: grants[0],
      browserBinding: binding,
    });
    // Medal has answered about THIS grant, and every answer spends it.
    await rt.vippsLink.clearBrowserBinding();
    if (outcome === 'linked') return 'linked';
    return outcome === 'conflict' ? 'link_conflict' : 'link_failed';
  } catch (error) {
    if (error instanceof PortalSessionExpiredError) {
      await rt.session.clearPortalSession();
      return 'session';
    }
    if (!(error instanceof PortalThrottledError)) {
      rt.logger.error({ err: error }, 'Vipps link grant could not be completed');
    }
    return 'link_failed';
  }
}

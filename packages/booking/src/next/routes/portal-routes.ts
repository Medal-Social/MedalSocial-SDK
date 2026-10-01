/**
 * The portal's route handlers: the e-mail code and Vipps-link code that mint
 * a session, «add a child» from the booking wizard, the hourly session touch,
 * the dead-session clear and the Vipps flash spend.
 *
 * ROUTE HANDLERS, NOT SERVER ACTIONS, and that is the whole reason they
 * exist: in Next 16 a server action that sets a cookie makes the client
 * re-fetch the route it was called from, which on the booking page would
 * re-render the whole force-dynamic wizard behind a login sheet whose point
 * was not to. A `fetch` to a route handler sets the cookie and triggers
 * nothing.
 *
 * THE SESSION TOKEN IS NEVER IN A RESPONSE: it goes from the seam straight
 * into `writePortalSession`, whose cookie is HttpOnly. The seam scrubs it (and
 * every other secret it holds) out of anything it throws.
 *
 * SAME-ORIGIN, STRICTLY, for everything that mints a session or writes to the
 * account: a page elsewhere must not be able to log a visitor in to an
 * account of its choosing (login CSRF), and a request that declares neither
 * `Origin` nor `Referer` is refused too — every browser sends `Origin` on a
 * `fetch` POST.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { type VerifyLoginFailure, verifyLoginInput } from '../../core/portal/login-input';
import type { BookingFamilyMember, BookingGuardian } from '../../core/types';
import { toBookingFamilyMember } from '../portal/guardian';
import {
  type PortalPersonResult,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
  PortalVippsConflictError,
} from '../portal/medal-portal';
import { declaresNoOrigin, isCrossOriginRequest, readBoundedText } from '../request';
import type { BookingRuntime } from '../runtime';

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function jsonFrom(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** An address, six digits and JSON punctuation fit in far less. */
const LOGIN_MAX_BODY_BYTES = 2 * 1024;

type VerifyAnswer =
  | { ok: true; guardian: BookingGuardian | null }
  | { ok: false; reason: VerifyLoginFailure | 'forbidden' };

/**
 * `POST <portalApi>/login/verify` — exchange an e-mail code for the session
 * cookie. Body `{ email, code }`. Answers, all `no-store`:
 *
 * - 200 `{ ok: true, guardian }` — the cookie is written. `guardian` is the
 *   parent narrowed exactly as the booking page narrows them, or `null` when
 *   the profile read after a good code failed.
 * - 400 / 401 `{ ok: false, reason: 'invalid' }` — a malformed body, or a
 *   wrong or expired code.
 * - 429 `throttled` · 503 `unreachable` · 403 for another origin.
 */
export async function loginVerifyRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const reply = (status: number, body: VerifyAnswer) => answer(status, body);
  if (declaresNoOrigin(request) || isCrossOriginRequest(request)) {
    return reply(403, { ok: false, reason: 'forbidden' });
  }

  const parsed = verifyLoginInput.safeParse(await jsonFrom(request, LOGIN_MAX_BODY_BYTES));
  if (!parsed.success) return reply(400, { ok: false, reason: 'invalid' });

  let session: Awaited<ReturnType<BookingRuntime['portal']['verifyLogin']>>;
  try {
    session = await rt.portal.verifyLogin(parsed.data.email, parsed.data.code);
  } catch (error) {
    if (error instanceof PortalThrottledError) {
      return reply(429, { ok: false, reason: 'throttled' });
    }
    // The seam never puts the code or a token in an error it throws.
    rt.logger.error(error, 'Portal login code could not be verified');
    return reply(503, { ok: false, reason: 'unreachable' });
  }
  if (session === null) return reply(401, { ok: false, reason: 'invalid' });

  await rt.session.writePortalSession(session.sessionToken, session.expiresAt);
  return reply(200, { ok: true, guardian: await rt.guardianFromSession(session.sessionToken) });
}

const PERSONS_MAX_BODY_BYTES = 2 * 1024;

const personInput = z.object({
  name: z.string().trim().min(1).max(60),
  birthYear: z
    .number()
    .int()
    .refine((year) => year >= new Date().getFullYear() - 18 && year <= new Date().getFullYear()),
  birthMonth: z.number().int().min(1).max(12).optional(),
  notes: z.string().trim().max(500).optional(),
});

type PersonsAnswer =
  | { ok: true; child: BookingFamilyMember }
  | {
      ok: false;
      reason: 'invalid' | 'session' | 'throttled' | 'unreachable' | 'forbidden';
      message?: string;
    };

/**
 * `POST <portalApi>/persons` — the wizard's «add a child» for a logged-in
 * parent: create the child in Medal, answer with them, narrowed exactly as the
 * booking page narrows the family (no stylist note, no contact id).
 *
 * Body `{ name, birthYear, birthMonth?, notes? }`. Answers, all `no-store`:
 * 201 `{ ok: true, child }` · 400 `invalid` (with the engine's `message`
 * where there is one) · 401 `session` · 429 `throttled` · 503 `unreachable`
 * · 403 for another origin.
 */
export async function personsRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const reply = (status: number, body: PersonsAnswer) => answer(status, body);
  if (declaresNoOrigin(request) || isCrossOriginRequest(request)) {
    return reply(403, { ok: false, reason: 'forbidden' });
  }
  const session = await rt.session.readPortalSession();
  if (session === null) return reply(401, { ok: false, reason: 'session' });

  const parsed = personInput.safeParse(await jsonFrom(request, PERSONS_MAX_BODY_BYTES));
  if (!parsed.success) return reply(400, { ok: false, reason: 'invalid' });
  const { name, birthYear, birthMonth, notes } = parsed.data;

  try {
    const result = await rt.portal.createPerson(session, {
      name,
      birthYear,
      ...(birthMonth === undefined ? {} : { birthMonth }),
      ...(notes === undefined || notes === '' ? {} : { notes }),
    });
    return reply(201, { ok: true, child: createdChild(result, parsed.data) });
  } catch (error) {
    if (error instanceof PortalSessionExpiredError) {
      return reply(401, { ok: false, reason: 'session' });
    }
    if (error instanceof PortalValidationError) {
      return reply(400, { ok: false, reason: 'invalid', message: error.message });
    }
    if (error instanceof PortalThrottledError) {
      return reply(429, { ok: false, reason: 'throttled' });
    }
    rt.logger.error(error, 'A child could not be added from the booking wizard');
    return reply(503, { ok: false, reason: 'unreachable' });
  }
}

/** The child just created, as the wizard sees them — by id, else by name and year. */
function createdChild(
  result: PortalPersonResult,
  wanted: { name: string; birthYear: number; birthMonth?: number }
): BookingFamilyMember {
  const family = result.profile.family;
  const created =
    (result.personId === null
      ? undefined
      : family.find((member) => member.personId === result.personId)) ??
    family.find((member) => member.name === wanted.name && member.birthYear === wanted.birthYear);
  if (created) return toBookingFamilyMember(created);
  return {
    name: wanted.name,
    birthYear: wanted.birthYear,
    ...(wanted.birthMonth === undefined ? {} : { birthMonth: wanted.birthMonth }),
  };
}

/**
 * `POST <portalApi>/session/touch` — keep the session cookie alive as long as
 * the session behind it. Medal slides a portal session every time it is used,
 * but the cookie was written once, at login; Server Components cannot set
 * cookies, so the portal calls this from the browser (once an hour at most).
 *
 * 204: Medal answered, the cookie is renewed. 401: no session, or one Medal no
 * longer honours — nothing is renewed or cleared here. 503: Medal could not be
 * asked. POST so no link, prefetch or crawler triggers it.
 */
export async function sessionTouchRoute(rt: BookingRuntime): Promise<Response> {
  const session = await rt.session.readPortalSession();
  if (session === null) return empty(401);

  try {
    await rt.portal.getMe(session);
  } catch (error) {
    if (error instanceof PortalSessionExpiredError) return empty(401);
    rt.logger.warn({ err: error }, 'Portal session touch could not reach Medal');
    return empty(503);
  }

  await rt.session.renewPortalSession(session);
  return empty(204);
}

function seeOther(path: string, request: Request, headers: Record<string, string> = {}): Response {
  const location = new URL(path, request.url);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location.toString(), 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * `GET <portalApi>/session/expired` — drop a session cookie Medal has stopped
 * honouring, then send the parent to the login.
 *
 * A Server Component cannot clear a cookie, and the login page sends anyone
 * WITH a cookie back to the portal, so a revoked cookie would bounce the
 * parent between the two. The portal page redirects HERE instead.
 *
 * It clears ONLY a cookie Medal itself refuses: a predictable GET that always
 * logged the parent out would be a logout-CSRF. If Medal cannot be reached the
 * cookie is kept too, and the portal shows its own «unreachable» card.
 */
export async function sessionExpiredRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const login = rt.paths.portalLogin;
  const session = await rt.session.readPortalSession();
  if (session === null) {
    return seeOther(login, request);
  }
  let dead: boolean;
  try {
    await rt.portal.getMe(session);
    dead = false;
  } catch (error) {
    dead = error instanceof PortalSessionExpiredError;
  }
  if (!dead) {
    return seeOther(rt.paths.portal ?? login, request);
  }
  await rt.session.clearPortalSession();
  return seeOther(login, request);
}

/**
 * `DELETE <portalApi>/vipps/flash` — spend the «Vipps linked» flash once the
 * profile has shown it. Same-origin only; 204 whether or not there was one.
 */
export async function vippsFlashRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  if (isCrossOriginRequest(request)) return empty(403);
  await rt.flash.clearVippsLinkFlash();
  return empty(204);
}

const LINK_MAX_BODY_BYTES = 1024;

const linkInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

type LinkAnswer =
  | { ok: true; guardian: BookingGuardian | null }
  | { ok: false; reason: 'invalid' | 'conflict' | 'throttled' | 'unreachable' | 'forbidden' };

/**
 * `POST <portalApi>/vipps/link/verify` — the e-mail code that confirms a
 * conflicted Vipps login, exchanged for the session cookie. The body is
 * `{ code }` and nothing else; the pending `link` and this browser's binding
 * come from their httpOnly cookies and go to Medal in the request body.
 *
 * 200 `{ ok: true, guardian }` (both Vipps cookies cleared) · 400 / 401
 * `invalid` (the cookies stay on a wrong code) · 409 `conflict` (the link is
 * spent, so the cookies go) · 429 · 503 · 403.
 */
export async function vippsLinkVerifyRoute(
  rt: BookingRuntime,
  request: Request
): Promise<Response> {
  const reply = (status: number, body: LinkAnswer) => answer(status, body);
  if (declaresNoOrigin(request) || isCrossOriginRequest(request)) {
    return reply(403, { ok: false, reason: 'forbidden' });
  }
  const parsed = linkInput.safeParse(await jsonFrom(request, LINK_MAX_BODY_BYTES));
  const code = parsed.success ? parsed.data.code : null;
  if (code === null) return reply(400, { ok: false, reason: 'invalid' });
  // No link or no binding in the jar — expired, or another browser — is the
  // same «wrong or expired code» Medal would give, without asking Medal.
  const pair = await rt.vippsLink.readVippsLinkPair();
  if (pair === null) return reply(401, { ok: false, reason: 'invalid' });

  let session: Awaited<ReturnType<BookingRuntime['portal']['verifyVippsLink']>>;
  try {
    session = await rt.portal.verifyVippsLink({
      link: pair.link,
      code,
      browserBinding: pair.binding,
    });
  } catch (error) {
    if (error instanceof PortalVippsConflictError) {
      await rt.vippsLink.clearVippsLinkPair();
      return reply(409, { ok: false, reason: 'conflict' });
    }
    if (error instanceof PortalThrottledError) {
      return reply(429, { ok: false, reason: 'throttled' });
    }
    rt.logger.error(error, 'A Vipps link code could not be verified');
    return reply(503, { ok: false, reason: 'unreachable' });
  }
  if (session === null) return reply(401, { ok: false, reason: 'invalid' });

  await rt.session.writePortalSession(session.sessionToken, session.expiresAt);
  await rt.vippsLink.clearVippsLinkPair();
  return reply(200, { ok: true, guardian: await rt.guardianFromSession(session.sessionToken) });
}

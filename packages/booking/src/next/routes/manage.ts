import { MedalApiError } from '@medalsocial/sdk';
import { NextResponse } from 'next/server';
import { toManageDto } from '../manage-dto';
import { MedalConfigError } from '../medal';
import { readBoundedText } from '../request';
import type { BookingRuntime } from '../runtime';
import { bookingErrorResponse, digestOf, isSlotTaken } from './shared';

/**
 * The two things the manage page can DO: call off an appointment, or move it.
 *
 * One route rather than `…/cancel` and `…/reschedule`, because the token is the
 * expensive part of this URL and there is no reason to have it in two places.
 * The action is a field on the body.
 *
 * SECURITY — the path segment is a live bearer credential for one booking:
 * whoever holds it can cancel or move that appointment. Three rules follow, and
 * every one of them is a rule about *this file*:
 *
 * - The token is read from the path and from nowhere else. A query string would
 *   be the same credential in the one place that is logged by every proxy
 *   between here and the visitor, and would let a link with `?token=` be
 *   crafted for a page that never offered one.
 * - Nothing here logs it, echoes it, or puts it in a response body. The upstream
 *   client already redacts it out of its own error messages (`safePath`), and
 *   the responses below carry a code and never the input that produced it.
 * - An unknown token gets the same 404 shape as a revoked one, which is what the
 *   engine already answers with — the endpoint is not an oracle for whether a
 *   booking exists.
 */

/**
 * What the browser may send. `startTs` is epoch milliseconds, the same unit the
 * availability route emits and the same one `pickSlot` stores, so nothing has to
 * reformat a time between choosing it and committing to it.
 */
interface ManageRequest {
  action?: unknown;
  reason?: unknown;
  startTs?: unknown;
}

function invalid(message: string): NextResponse {
  return bookingErrorResponse('invalidInput', 400, message);
}

/**
 * The `Idempotency-Key` for one move: the booking's token and the instant it is
 * being moved to, hashed together.
 *
 * A reschedule is an insert plus a cancel, so a second identical request would
 * otherwise find the booking already cancelled and answer 409 — a double tap on
 * «Bekreft endring» reporting failure for a move that succeeded. Deriving the
 * key from the two things that identify the move makes the retry a replay.
 *
 * The digest, never the token. Medal stores the request identity against the
 * key, so a plaintext token here would write a live credential into a table that
 * outlives the appointment — the same reason the engine hashes the token out of
 * its own idempotency identity and API log. Two visitors cannot collide either,
 * since the token is unique per booking; and a visitor who picks a different
 * hour derives a different key, which is correctly a second move rather than a
 * replay of the first.
 */
async function moveKey(token: string, startTs: number): Promise<string> {
  return digestOf(`reschedule:${token}:${startTs}`);
}

/**
 * The `Idempotency-Key` for one cancellation — the booking's token, hashed.
 *
 * The same hazard the move key exists for, and it had been left off this half.
 * Cancelling twice is a `CONFLICT` from the engine, because the second call
 * finds a booking that is already cancelled — so a dropped RESPONSE (the write
 * landed, the answer did not) turns the visitor's perfectly reasonable retry
 * into «det gikk ikke» for an appointment that IS cancelled. A disabled button
 * only stops the concurrent double tap; it does nothing about the retry after
 * an ambiguous network result.
 *
 * No second component, unlike the move: a booking has exactly one cancellation,
 * so the token alone identifies it. Two attempts with different reasons are
 * still one cancellation, and the first reason is the one that sticks — which
 * is the right answer, since it is the one the visitor gave before anything
 * went wrong.
 *
 * The digest and never the token, for the reason `moveKey` gives.
 */
async function cancelKey(token: string): Promise<string> {
  return digestOf(`cancel:${token}`);
}

/**
 * Every way a manage action can fail, in codes the page has a Norwegian
 * sentence for.
 *
 * `windowPassed` is the one that matters. The engine enforces both windows on
 * the write and raises `CONFLICT` with `CANCEL_WINDOW_PASSED` /
 * `RESCHEDULE_WINDOW_PASSED` in the message — the code alone cannot tell it from
 * a taken slot, exactly as the create route has to read `SLOT_TAKEN` out of the
 * message. It is reachable without anyone doing anything wrong: `can_cancel` was
 * true when the page rendered, and the visitor sat on it until it was not.
 *
 * The upstream's own message never travels. Medal writes for the integrator
 * holding the API key, and its 404 for this route would be the same sentence
 * whether the token was revoked, GDPR-erased, or belongs to another salon.
 */
function manageErrorResponse(rt: BookingRuntime, error: unknown, action: string): NextResponse {
  if (error instanceof MedalConfigError) {
    rt.logger.error({ err: error, action }, 'Booking API is not configured');
    return bookingErrorResponse('unconfigured', 503);
  }

  if (error instanceof MedalApiError) {
    if (error.status === 404) {
      return bookingErrorResponse('notFound', 404);
    }
    if (error.code === 'CONFLICT') {
      if (error.message.includes('WINDOW_PASSED')) {
        return bookingErrorResponse('windowPassed', 409);
      }
      if (isSlotTaken(error)) {
        return bookingErrorResponse('slotTaken', 409);
      }
      return bookingErrorResponse('conflict', 409);
    }
    if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_INPUT') {
      return bookingErrorResponse('invalidInput', 400);
    }
  }

  // `action` and not the token: which of the two failed is the whole reason to
  // log a line here, and the token is the one thing that must never reach a log
  // stream that outlives the booking.
  rt.logger.error({ err: error, action }, 'Booking manage action failed');
  return bookingErrorResponse('upstreamError', 502);
}

/**
 * The booking's service id, for expiring its cached slots after a write.
 *
 * Asked for ALONGSIDE the write rather than after it, so it adds no round trip
 * (after a move the old token resolves to the cancelled row, which still names
 * the service — but there is no reason to wait for that). Best effort: `null`
 * leaves the cache to its ~60 s bound, never fails the action.
 */
async function serviceIdOf(rt: BookingRuntime, token: string): Promise<string | null> {
  try {
    return (await rt.medal.getManage(token)).service_id ?? null;
  } catch {
    return null;
  }
}

/** Expire the booking's slots — cached and in this colo's seeds — once the
 * write has landed. */
async function expireAfterWrite(
  rt: BookingRuntime,
  serviceId: Promise<string | null>
): Promise<void> {
  const id = await serviceId;
  if (id === null) return;
  rt.catalogue.expireSlots([id]);
  await rt.seed.expireBookingSeeds([id]);
}

/**
 * The manage body's ceiling: an action, a reason chip and an instant fit in
 * a few hundred bytes. Read in bytes before anything parses it, as the portal
 * routes cap theirs.
 */
const MANAGE_MAX_BODY_BYTES = 4 * 1024;

export async function manageRoute(
  rt: BookingRuntime,
  request: Request,
  token: string
): Promise<Response> {
  if (!token) {
    // Unreachable through the router, which only matches a non-empty segment —
    // but this is the one function in the app where an empty credential must
    // never be forwarded as if it were one.
    return invalid('token is required');
  }

  let parsed: unknown;
  try {
    const text = await readBoundedText(request, MANAGE_MAX_BODY_BYTES);
    if (text === null) return invalid('body is too large');
    parsed = JSON.parse(text);
  } catch {
    return invalid('body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('body must be a JSON object');
  }
  const body = parsed as ManageRequest;

  if (body.action === 'cancel') {
    try {
      // Trimmed to nothing means the visitor picked no chip, and the reason is
      // optional to the engine — `''` is a value it would store as a reason
      // that says nothing. Absent is the honest form of «they did not say».
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const serviceId = serviceIdOf(rt, token);
      await rt.medal.cancelManage(
        token,
        reason.length > 0 ? reason : undefined,
        await cancelKey(token)
      );
      await expireAfterWrite(rt, serviceId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return manageErrorResponse(rt, error, 'cancel');
    }
  }

  if (body.action === 'reschedule') {
    const startTs = body.startTs;
    // `Number.isFinite` and not `Number(...)`, for the reason the create route
    // gives: `Number(null)` is 0, and a cleared slot serialises as null — a
    // lenient parse would ask the engine to move the appointment to 1970.
    if (!Number.isFinite(startTs)) {
      return invalid('startTs must be a timestamp');
    }
    const serviceId = serviceIdOf(rt, token);
    try {
      const result = await rt.medal.rescheduleManage(
        token,
        startTs as number,
        await moveKey(token, startTs as number)
      );
      await expireAfterWrite(rt, serviceId);
      // The NEW booking's token, relayed so the page can send the visitor to a
      // manage link that still works: the token they arrived with now belongs
      // to the cancelled row and from here on resolves to «avbestilt».
      //
      // Absent on an idempotent replay — the engine mints it exactly once — so
      // the field is optional and the page has a path for not getting one.
      return NextResponse.json({
        ok: true,
        ...(typeof result?.manage_token === 'string' ? { manageToken: result.manage_token } : {}),
      });
    } catch (error) {
      // The move lost its slot: the cache offered one that was already gone.
      if (isSlotTaken(error)) await expireAfterWrite(rt, serviceId);
      return manageErrorResponse(rt, error, 'reschedule');
    }
  }

  return invalid('action must be "cancel" or "reschedule"');
}

/**
 * `GET <api>/manage/<token>` — the booking the token names, as the manage page
 * renders it, for a client that loads it itself. The same 404 for an unknown
 * token as for a revoked one; the token is never echoed or logged, and the
 * answer is never stored by anyone (`no-store`, `no-referrer`).
 */
export async function manageSummaryRoute(
  rt: BookingRuntime,
  _request: Request,
  token: string
): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (!token) return invalid('token is required');
  try {
    const booking = toManageDto(await rt.medal.getManage(token));
    if (booking === null) return NextResponse.json({ error: 'notFound' }, { status: 404, headers });
    return NextResponse.json({ booking }, { headers });
  } catch (error) {
    if (error instanceof MedalApiError && error.status === 404) {
      return NextResponse.json({ error: 'notFound' }, { status: 404, headers });
    }
    const response = manageErrorResponse(rt, error, 'read');
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}

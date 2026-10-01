/**
 * `POST <api>/create` — one submission, one booking, or one family,
 * all-or-nothing.
 *
 * The logic is the source site's create route, moved unchanged: the
 * idempotency key from the wizard's nonce and the canonical body, the
 * marketing consent filed through `after()` once the booking exists, the live
 * re-read of openings on a taken slot, and the slot-cache and seed expiry on
 * every write.
 */

import { MedalApiError } from '@medalsocial/sdk';
import { after, NextResponse } from 'next/server';
import { marketingConsent } from '../../core/consent';
import type { BookingSlotDto } from '../../core/types';
import { type CreateBookingBody, MedalConfigError } from '../medal';
import { PortalSessionExpiredError } from '../portal/medal-portal';
import { readBoundedText } from '../request';
import type { BookingRuntime } from '../runtime';
import { bookingErrorResponse, isSlotTaken, parseRange } from './shared';

/**
 * What the wizard submits. Every optional field here is one `WizardState`
 * seeds as `''` or `null`, which is the whole reason this module exists.
 *
 * `consentMarketing` does not travel on to Medal's create body — that schema
 * has nowhere to put it, and it should not: a consent is a dated record of a
 * sentence somebody agreed to, not a column on an appointment. It is written
 * separately, once the booking has succeeded, by `recordMarketingConsent`.
 */
interface CreateRequest {
  items?: Array<{
    serviceId?: unknown;
    resourceId?: unknown;
    startTs?: unknown;
    bookedForName?: unknown;
    bookedForBirthYear?: unknown;
    /** A saved child's id (SP10) — forwarded only under the phone rule; see `withPersons`. */
    bookedForPersonId?: unknown;
  }>;
  contact?: { phone?: unknown; name?: unknown; email?: unknown };
  notes?: unknown;
  consentTerms?: unknown;
  consentMarketing?: unknown;
  /**
   * Half of the idempotency key — the wizard's half. Minted once when «Bekreft»
   * comes up and resent unchanged on every retry of the same submission; see
   * `idempotencyKeyFor` for why it is only half.
   *
   * Never forwarded to Medal. It identifies an *attempt*, and the engine has
   * nowhere to put one.
   */
  submissionNonce?: unknown;
  /**
   * The wizard's availability window, so a `slotTaken` can answer with the
   * openings over exactly the days the time step shows. Never forwarded to
   * Medal and not part of the idempotency key.
   */
  window?: { fromTs?: unknown; toTs?: unknown };
}

/** The window the wizard shows when it names none: seven local days from now. */
const DEFAULT_WINDOW_DAYS = 7;

/**
 * The body's `window`, held to the same guards as the read routes' range
 * (`parseRange`: readable, ordered, at most 62 days) — or the default window.
 * Never an error: this only shapes what a refusal carries back.
 */
function slotWindow(
  rt: BookingRuntime,
  raw: CreateRequest['window']
): { fromTs: number; toTs: number } {
  const fromTs = raw?.fromTs;
  const toTs = raw?.toTs;
  if (typeof fromTs === 'number' && typeof toTs === 'number') {
    const parsed = parseRange(
      new URLSearchParams({ from_ts: String(fromTs), to_ts: String(toTs) })
    );
    if (!('error' in parsed)) return parsed;
  }
  const { fromTs: defaultFrom, toTs: defaultTo } = rt.clock.window(Date.now(), DEFAULT_WINDOW_DAYS);
  return { fromTs: defaultFrom, toTs: defaultTo };
}

/**
 * What is free NOW for each service in a refused booking, read live past the
 * slot cache — the entry that offered the lost slot may still be there, since
 * the tag expiry lands after this response. Best effort per service: one that
 * fails is left out, and the wizard reads it the ordinary way.
 */
async function liveSlotsFor(
  rt: BookingRuntime,
  serviceIds: string[],
  window: { fromTs: number; toTs: number }
): Promise<Record<string, BookingSlotDto[]>> {
  const read = await Promise.all(
    [...new Set(serviceIds)].map(async (serviceId) => {
      try {
        const slots = await rt.catalogue.cachedAvailability(
          { serviceId, ...window },
          { fresh: true }
        );
        return [serviceId, slots.flatMap(rt.dto.toBookingSlotDto)] as const;
      } catch (error) {
        rt.logger.warn({ err: error, serviceId }, 'Could not re-read openings after a taken slot');
        return null;
      }
    })
  );
  return Object.fromEntries(read.filter((entry) => entry !== null));
}

/**
 * The fix for the trap `medal-client.ts` documents and deliberately refuses to
 * apply on its own.
 *
 * Empty is not "absent" to this API, and the inconsistency is what hides it:
 * the engine takes `contact.name` and `booked_for_name` as
 * `z.string().trim().min(1).optional()` — `''` is a 400 — while `email`, right
 * next to them, has no `min` and lets `''` straight through. The wizard seeds
 * all three to `''` because an empty text input has no other value, so without
 * this a parent who skips «Ditt navn», or leaves «Hvem skal klippes?» blank,
 * cannot book at all — and the error names a field they left empty on purpose.
 */
function blankToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The same rule for the one optional field that is a number.
 *
 * An emptied number input serialises as `null` (or `NaN`, which
 * `JSON.stringify` also writes as `null`), and `z.number().optional()` refuses
 * null exactly as `z.string().optional()` does.
 */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The same loose shape «Bekreft» checks, kept in step with `looksLikeEmail` there.
 *
 * Loose on purpose: the field is optional, so the only job is to refuse an
 * address that cannot receive anything. A stricter pattern rejects real
 * addresses, and refusing to book a haircut over an e-mail nobody had to give
 * is the worse error.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(message: string): NextResponse {
  return bookingErrorResponse('invalidInput', 400, message);
}

/**
 * Turn the wizard's submission into Medal's create body, or say why not.
 *
 * Every rejection here is one the engine would also make. Answering locally is
 * not just faster: the engine's messages are written for the integrator holding
 * the API key and quote wire field names (`contact.phone`, `items.0.start_ts`)
 * that mean nothing to the person filling in the form.
 */
function toMedalBody(body: CreateRequest): { body: CreateBookingBody } | { error: NextResponse } {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { error: invalid('items must contain at least one service') };
  }

  const phone = blankToUndefined(body.contact?.phone);
  if (phone === undefined) {
    return { error: invalid('contact.phone is required') };
  }

  // The engine takes `email` as `.trim().max(320)` with no shape check and no
  // `min`, so `kari@` is a 200 from its point of view — the appointment is made
  // and its confirmation and calendar invitation go nowhere. «Bekreft» checks the
  // same shape at the field; this is the boundary saying it again, because the
  // route is reachable without the wizard and «booked but unreachable» is not a
  // state worth being able to create.
  const email = blankToUndefined(body.contact?.email);
  if (email !== undefined && !EMAIL_SHAPE.test(email)) {
    return { error: invalid('contact.email is not a valid address') };
  }

  // Checked last so a malformed payload reports the malformation, but checked
  // before anything is sent: the terms box is the legal gate on the booking,
  // not a field the engine will catch for us — it has no idea it exists.
  if (body.consentTerms !== true) {
    return { error: invalid('consentTerms must be accepted') };
  }

  const items: CreateBookingBody['items'] = [];
  for (const [index, item] of body.items.entries()) {
    const serviceId = blankToUndefined(item?.serviceId);
    if (serviceId === undefined) {
      return { error: invalid(`items.${index}.serviceId is required`) };
    }
    // `Number.isFinite` and not `Number(...)`: `Number(null)` is 0, and a
    // cleared slot serialises as null — so a lenient parse would quietly book
    // the haircut at midnight on 1 January 1970.
    const startTs = item?.startTs;
    if (!Number.isFinite(startTs)) {
      return { error: invalid(`items.${index}.startTs must be a timestamp`) };
    }
    items.push({
      service_id: serviceId,
      // `null` is the ORDINARY value here — «Første ledige» is the default
      // choice on step 2 and the one the salon prefers — and the engine's
      // `z.string().trim().min(1).optional()` refuses it.
      resource_id: blankToUndefined(item?.resourceId),
      start_ts: startTs as number,
      booked_for_name: blankToUndefined(item?.bookedForName),
      booked_for_birth_year: numberOrUndefined(item?.bookedForBirthYear),
    });
  }

  return {
    body: {
      items,
      contact: {
        phone,
        name: blankToUndefined(body.contact?.name),
        email,
      },
      notes: blankToUndefined(body.notes),
    },
  };
}

/**
 * The `Idempotency-Key` for one submission: the wizard's nonce and the body it
 * is submitting, hashed together.
 *
 * Both halves are load-bearing, and each way of getting it wrong is its own
 * failure. The one this route shipped with was to use neither: a fresh
 * `crypto.randomUUID()` per POST is a fresh key per tap, which is two bookings.
 * The two near misses:
 *
 * - **Nonce alone**, taken from the client as the key, would be a
 *   cross-customer leak. Medal's idempotency store is scoped to the workspace,
 *   not to the visitor, so if two browsers ever sent the same key the second
 *   would be handed the first one's cached response — manage tokens included,
 *   and a manage token is a live credential for somebody else's appointment.
 * - **Body alone** would replay: two families booking the same service at the
 *   same time is a slot clash the engine should answer, and two identical
 *   submissions weeks apart are two haircuts.
 *
 * Together they give the property the wizard actually needs. A retry of the
 * same submission — the double tap, the reload on a stalled request — carries
 * the same nonce and the same body, so it hashes to the same key and books
 * once. Two visitors cannot collide even if their nonces somehow matched,
 * because two families differ in at least the phone number; and a visitor who
 * changes their mind about the slot changes the body, which is a new key and
 * correctly a new booking.
 *
 * `crypto.subtle` rather than `node:crypto`: this runs on Cloudflare Workers,
 * where the Web Crypto global is the one that exists.
 *
 * The body is hashed *after* `toMedalBody`, which is what makes it canonical —
 * trimmed, blanks already dropped, keys in the fixed order this file writes
 * them. Two POSTs that differ only in whitespace would create the same booking,
 * so they had better derive the same key.
 *
 * No nonce means an older wizard, or a caller that is not the wizard. Those
 * still book — a per-request UUID, exactly as before — they simply do not get
 * the guarantee. Refusing them would turn a missing nicety into an outage.
 */
async function idempotencyKeyFor(nonce: unknown, body: CreateBookingBody): Promise<string> {
  if (typeof nonce !== 'string' || nonce.trim().length === 0) return crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${nonce}${JSON.stringify(body)}`)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The marketing box on «Bekreft», filed as its own record — and never at the
 * booking's expense.
 *
 * Three rules, all of them load-bearing:
 *
 * - Only when the box was ticked. `granted: false` is a *withdrawal*, and
 *   writing one for every parent who left the box alone would overwrite the
 *   consent they gave last time they booked.
 * - Only when there is an e-mail address. The record is keyed on it, and
 *   consent to be e-mailed without somewhere to e-mail is not a consent to
 *   anything.
 * - Never fatal. The appointment is what the customer came for; a consent
 *   endpoint that is down, or an API key scoped to bookings alone, must cost
 *   the salon a mailing-list entry and not a haircut. Logged at `warn` so the
 *   silence is at least visible from the outside.
 *
 * Scheduled with `after` rather than awaited or floated, and both of the other
 * two are worse in their own direction. AWAITED, this sat between the booking
 * and the 201 with no timeout under it, so a consent endpoint that accepted the
 * connection and never answered withheld a booking that had already been made —
 * the browser gives up, the visitor reloads, `DetailsStep` remounts and mints a
 * fresh submission nonce, and the retry derives a different idempotency key and
 * books the child a second time. A try/catch does nothing about a stall.
 * FLOATED, on Workers a promise nobody is holding when the response goes out is
 * cancelled, so the consent would be written on a fast connection and lost on a
 * slow one. `after` is the one that answers first and still finishes the work:
 * on this runtime it lands on `ctx.waitUntil`, which the opennextjs-cloudflare
 * wrapper holds the whole request with — so the isolate stays alive for the
 * write while the visitor is already reading their confirmation.
 */
async function recordMarketingConsent(
  rt: BookingRuntime,
  email: string | undefined,
  granted: unknown
): Promise<void> {
  const consent = marketingConsent(rt.config);
  // No marketing box on this site: nothing anybody ticked, nothing to file.
  if (granted !== true || email === undefined || consent === null) return;
  try {
    await rt.medal.recordConsent({
      email,
      consent_type: 'marketing_email',
      granted: true,
      source: consent.source,
      // The sentence that was actually on the screen, so what they agreed to is
      // recoverable years later rather than inferred from a boolean.
      consent_text: consent.text,
      version: consent.version,
    });
  } catch (error) {
    rt.logger.warn({ err: error }, 'Marketing consent was not recorded');
  }
}

/**
 * Every way a submission can fail, in the vocabulary `WizardState.error`
 * already speaks. The codes are consumed as-is, so the spelling is part of the
 * contract rather than a description of it.
 *
 * `VALIDATION_ERROR` and not just `INVALID_INPUT`: the engine raises
 * `ErrorCode.INVALID_INPUT` internally, but `withBookingApiErrors` routes it
 * through `validationError`, so what actually reaches the wire is `422
 * VALIDATION_ERROR`. Matching on the internal name alone would be a branch that
 * never runs — and every rejected body would surface as a bare 502.
 *
 * The 400 is deliberate where the upstream said 422: to the browser this IS a
 * bad request, and the wizard has one `invalidInput` state for it either way.
 */
function createErrorResponse(rt: BookingRuntime, error: unknown): NextResponse {
  if (error instanceof MedalConfigError) {
    rt.logger.error({ err: error }, 'Booking API is not configured');
    return bookingErrorResponse('unconfigured', 503);
  }

  if (error instanceof MedalApiError) {
    // This submission's key already names a booking attempt — still running,
    // or made with a body this one does not match (an older wizard, a check
    // that answered differently). Either way something may be booked, and a
    // second try under the same key cannot book it again: «check your e-mail»,
    // not «try again». Logged, because a key conflict should not happen.
    if (error.code === 'IDEMPOTENCY_KEY_CONFLICT' || error.code === 'IDEMPOTENCY_IN_PROGRESS') {
      rt.logger.warn({ err: error }, 'Booking create hit an idempotency key already in use');
      return bookingErrorResponse('inProgress', 409);
    }
    if (error.code === 'CONFLICT') {
      // Two different answers on the time step: `slotTaken` sends the visitor back
      // with the neighbouring times highlighted, which a duplicate-key or
      // unseatable-party conflict has no slot to do. The engine distinguishes
      // them only in the message, so this is the seam. (`createRoute` answers a
      // taken slot itself, with the live openings, before it gets here.)
      /* v8 ignore next -- the slotTaken side is kept as moved; createRoute answers it first */
      return bookingErrorResponse(isSlotTaken(error) ? 'slotTaken' : 'conflict', 409);
    }
    if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_INPUT') {
      return bookingErrorResponse('invalidInput', 400);
    }
  }

  rt.logger.error({ err: error }, 'Booking create failed');
  return bookingErrorResponse('upstreamError', 502);
}

/**
 * The create body's ceiling, read in bytes before anything parses it (as the
 * portal routes cap theirs). A family of three is about two kilobytes; this
 * leaves room for the largest party a site may configure and a long note,
 * and refuses the megabyte nobody's wizard sends.
 */
const CREATE_MAX_BODY_BYTES = 32 * 1024;

/**
 * One submission, one booking — or one family, all-or-nothing, when `items`
 * carries more than one child.
 *
 * `Idempotency-Key` is what makes a double-tapped «Bekreft» on a flaky mobile
 * connection book once instead of twice, and it only does that if the second
 * tap derives the *same* key as the first. It cannot be minted here for that
 * reason: a fresh UUID per POST is a fresh key per tap, which is two bookings.
 * So the wizard sends the nonce and this route mixes the body in —
 * `idempotencyKeyFor` explains why it takes both.
 */
export async function createRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  let parsed: unknown;
  try {
    const text = await readBoundedText(request, CREATE_MAX_BODY_BYTES);
    if (text === null) return invalid('body is too large');
    parsed = JSON.parse(text);
  } catch {
    // A body that will not parse is the browser's fault, not Medal's. Letting
    // it fall into the catch below would answer 502 and point the salon at an
    // outage that is not happening.
    return invalid('body must be valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('body must be a JSON object');
  }

  const mapped = toMedalBody(parsed as CreateRequest);
  if ('error' in mapped) return mapped.error;
  // ONE SUBMISSION, ONE KEY, ONE BODY. The key is derived from what the
  // CLIENT asked for — ids included, before the server checks them — and the
  // body Medal is sent is a pure function of that request and the profile.
  // Medal's idempotency store compares the body's hash under a key: the same
  // key with a different body is 409 IDEMPOTENCY_KEY_CONFLICT, not a replay.
  // So a profile read that FAILS is not «send the names» — that would make
  // the retry, whose read succeeds, a different body under the same key — it
  // is a 503 before anything is booked, and the retry runs the same check.
  // `toMedalBody` has already refused a missing or empty `items`; the `?? []`
  // is kept as moved.
  /* v8 ignore next */
  const requestedIds = requestedPersonIds((parsed as CreateRequest).items ?? []);
  const keyBody = withIds(mapped.body, requestedIds, null);
  const checked = await withPersons(rt, mapped.body, requestedIds);
  if (checked === null) {
    return NextResponse.json({ error: 'upstreamError', retryable: true }, { status: 503 });
  }
  mapped.body = checked;

  try {
    // Inside the try, though nothing about a SHA-256 of a string this route
    // just built should throw: if the runtime ever disagrees, a logged 502 and
    // «timen ble ikke satt opp» is true — nothing was booked — where an
    // unhandled rejection would be a bare 500 with no line in the log saying
    // which booking it was.
    const idempotencyKey = await idempotencyKeyFor(
      (parsed as CreateRequest).submissionNonce,
      keyBody
    );
    const result = await rt.medal.createBooking(mapped.body, idempotencyKey);
    const booked = Array.isArray(result.bookings) ? result.bookings : [];
    // A null entry is a short answer, not a throw: the caches below must still go.
    const ids = booked.map((booking) => (booking as { id?: unknown } | null)?.id);
    const whole =
      booked.length === mapped.body.items.length &&
      ids.every((id) => typeof id === 'string' && id.length > 0) &&
      new Set(ids).size === ids.length;
    // The slots just taken are in the slot cache and in this colo's booking
    // seeds; expire both so neither this parent going back nor the next
    // visitor is offered them again.
    rt.catalogue.expireSlots(bookedServiceIds(mapped.body));
    await rt.seed.expireBookingSeeds(bookedServiceIds(mapped.body));
    // ONE BOOKING PER LINE, each with its own DISTINCT id, or no confirmation: a short
    // answer would hand the wizard lines with no booking behind them (and
    // calendar entries with no UID of their own). Something may be booked, so
    // the caches above still go; the answer is the generic create failure,
    // whose attempt the wizard keeps for the replay under the same key — and
    // no consent is filed for an appointment nobody can confirm.
    if (!whole) {
      rt.logger.error(
        { expected: mapped.body.items.length, received: booked.length },
        'Booking create answered without one booking per line'
      );
      return bookingErrorResponse('upstreamError', 502);
    }
    // After the booking, never before: a consent recorded for an appointment
    // that then failed to exist is a mailing-list entry the customer never
    // agreed to give. `after` keeps that ordering — it is scheduled here, so it
    // cannot run for a `createBooking` that threw — while taking the write out
    // from between the appointment and the answer.
    after(() =>
      recordMarketingConsent(
        rt,
        mapped.body.contact.email,
        (parsed as CreateRequest).consentMarketing
      )
    );
    // Deliberately no start time: the endpoint does not send one back, and the
    // confirmation screen renders the slot the visitor picked. Echoing a time
    // from here would give it a second source to disagree with.
    return NextResponse.json(
      {
        bookings: booked.map((booking) => ({
          id: booking.id,
          manageToken: booking.manage_token,
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    // SLOT_TAKEN means the cache offered a slot that was already gone. Expired
    // so the time step this visitor is sent back to is drawn from a live read.
    if (isSlotTaken(error)) {
      const serviceIds = bookedServiceIds(mapped.body);
      rt.catalogue.expireSlots(serviceIds);
      await rt.seed.expireBookingSeeds(serviceIds);
      // And the answer carries the live openings, so the wizard redraws the
      // time step from them rather than re-reading through the cache.
      const freshSlots = await liveSlotsFor(
        rt,
        serviceIds,
        slotWindow(rt, (parsed as CreateRequest).window)
      );
      return NextResponse.json({ error: 'slotTaken', freshSlots }, { status: 409 });
    }
    return createErrorResponse(rt, error);
  }
}

function bookedServiceIds(body: CreateBookingBody): string[] {
  return body.items.map((item) => item.service_id);
}

/** Medal's person ids are Convex ids; anything else is not one worth asking about. */
const PERSON_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `booked_for_person_id` on each line — THE PHONE RULE (SP10).
 *
 * Medal resolves a booking's contact by the PHONE first, then the e-mail, and
 * a person id is only valid on the contact who owns that child: an id sent
 * under a number that resolves to somebody else is a 404 for the whole
 * booking. So an id is forwarded only when all of this holds, and otherwise
 * the line goes as it always did — by name and year:
 *
 * - the browser holds a portal session (the `portal.cookieName` cookie),
 * - Medal still honours it and names the parent's phone,
 * - that phone and the one submitted are the same number (national digits),
 * - and the id is one of THAT parent's children.
 *
 * The browser already applies the phone rule before it sends an id; this is
 * the server not trusting it, because the route is reachable without the
 * wizard and a wrong id costs the whole family's booking.
 *
 * DETERMINISTIC, for the idempotency key's sake (see `POST`): ids are dropped
 * only when the check SUCCEEDED and said no — no session, an expired one, a
 * profile with another phone, a child who is not theirs — which a retry
 * against the same profile says again. A check that could not be made is
 * `null`, answered 503 without booking.
 *
 * THE COST: one extra round trip to Medal (`GET /portal/me`, with the
 * session) before the booking — only for a submission that carries an id,
 * which only a logged-in parent's wizard sends. A booking by names asks
 * nothing extra.
 */
async function withPersons(
  rt: BookingRuntime,
  body: CreateBookingBody,
  ids: ReadonlyArray<string | null>
): Promise<CreateBookingBody | null> {
  if (ids.every((id) => id === null)) return body;
  const owned = await ownedPersonIds(rt, body.contact.phone);
  if (owned === null) return null;
  if (owned.size === 0) return body;
  return withIds(body, ids, owned);
}

/** The ids the client sent, one per line, `null` where none (or not an id). */
function requestedPersonIds(requested: NonNullable<CreateRequest['items']>): Array<string | null> {
  return requested.map((item) => {
    const id = item?.bookedForPersonId;
    return typeof id === 'string' && PERSON_ID_SHAPE.test(id) ? id : null;
  });
}

/** `body` with each line's id set — all of them, or only those in `allowed`. */
function withIds(
  body: CreateBookingBody,
  ids: ReadonlyArray<string | null>,
  allowed: ReadonlySet<string> | null
): CreateBookingBody {
  if (ids.every((id) => id === null)) return body;
  return {
    ...body,
    items: body.items.map((item, index) => {
      const id = ids[index] ?? null;
      return id !== null && (allowed === null || allowed.has(id))
        ? { ...item, booked_for_person_id: id }
        : item;
    }),
  };
}

/**
 * The logged-in parent's children's ids — empty unless their phone is `phone`,
 * `null` when Medal could not be asked (an outage, a throttle): not an answer.
 */
async function ownedPersonIds(rt: BookingRuntime, phone: string): Promise<Set<string> | null> {
  const { nationalDigits } = rt.phone;
  try {
    const session = await rt.session.readPortalSession();
    if (session === null) return new Set();
    const profile = await rt.portal.getMe(session);
    if (profile.phone === null) return new Set();
    if (nationalDigits(profile.phone) !== nationalDigits(phone)) return new Set();
    return new Set(
      profile.family.flatMap((member) => (member.personId === null ? [] : [member.personId]))
    );
  } catch (error) {
    // A session Medal no longer honours is an answer, and the same one on a
    // retry: nobody is logged in, so the booking goes by names.
    if (error instanceof PortalSessionExpiredError) return new Set();
    // The seam scrubs the session.
    rt.logger.warn({ err: error }, 'Could not check the booking’s person ids; asking for a retry');
    return null;
  }
}

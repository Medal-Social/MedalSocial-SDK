import type {
  Portal,
  PortalExport,
  PortalLocale,
  PortalPersonCreateInput,
  PortalPersonPatch,
  PortalProfilePatch,
} from '@medalsocial/sdk';
import { MedalApiError } from '@medalsocial/sdk';
import type { BookingConfig } from '../../core/config';
import {
  createPortalDto,
  type PortalBookingDto,
  type PortalProfileDto,
  toPortalProfileDto,
} from '../../core/portal/dto';
import { type MedalSeam, unwrap } from '../medal';
import { DEFAULT_PORTAL_MESSAGES, type PortalMessages } from '../options';

/**
 * The portal seam: everything `/min-side` asks Medal, in this site's own terms.
 *
 * The sibling of `lib/booking/medal-client.ts`, and built on the same SDK. The
 * difference is the credential. The booking seam carries a per-appointment
 * manage token on a handful of calls; every call here except the two login
 * steps carries the parent's SESSION — a bearer credential for their whole
 * account, read from the session cookie by `portal/session.ts` and
 * handed in as a plain string. This module is the last place that string is
 * known by name before it goes on the wire, which makes it the last place two
 * things can be guaranteed:
 *
 * 1. **It is not in any error that leaves here.** The SDK formats the failing
 *    request into its messages, and the session travels in a header of that
 *    request; whatever an action lets escape is logged verbatim by
 *    `next-safe-action`'s error handler and a log is copied to places a cookie
 *    is not. `withSession` scrubs the value out of the message and stack of
 *    anything it rethrows — the same instance, so `instanceof`, `status` and
 *    `code` still hold for whoever catches it.
 * 2. **It is never logged here.** There is no `logger` import in this file on
 *    purpose. The one thing a log line about a portal failure must not contain
 *    is the thing every function in this file holds.
 *
 * Two errors are this module's own vocabulary, because two upstream answers
 * are decisions for the page rather than failures: `PortalSessionExpiredError`
 * (Medal no longer honours the cookie — clear it and send the parent back to
 * the login) and `PortalThrottledError` (Medal is rate-limiting this address —
 * the login copy already says «if we have your address, a code is on its way»,
 * and a throttle must not become an oracle for which addresses exist).
 * `PortalValidationError` carries the engine's message for a rejected profile
 * edit; it is written for integrators and quotes wire field names, so the form
 * should prefer its own copy and fall back to this.
 */

/** Medal answered 401 with a `PORTAL_SESSION_*` code: the cookie is dead. */
export class PortalSessionExpiredError extends Error {
  constructor() {
    super('portal session expired');
    this.name = 'PortalSessionExpiredError';
  }
}

/** Medal answered 429: this address has asked for too many codes. */
export class PortalThrottledError extends Error {
  constructor() {
    super('portal request throttled');
    this.name = 'PortalThrottledError';
  }
}

/** Medal rejected a profile edit; `message` is the engine's own sentence. */
export class PortalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalValidationError';
  }
}

/**
 * Medal answered 503 `VIPPS_NOT_CONFIGURED`: this workspace has no Vipps
 * credentials (yet). A decision for the login page — show the e-mail form
 * and say so — not a failure.
 */
export class PortalVippsUnavailableError extends Error {
  constructor() {
    super('vipps login unavailable');
    this.name = 'PortalVippsUnavailableError';
  }
}

/** One child as the editor writes it, in this site's own terms. */
export interface PortalPersonInput {
  name: string;
  birthYear: number;
  /** `null` clears; absent leaves it alone. */
  birthMonth?: number | null;
  notes?: string | null;
  preferredResourceId?: string | null;
}

/** What a person edit reports: the profile as Medal now holds it, and whether
 * the SP10 route was there to take the details. */
export interface PortalPersonResult {
  profile: PortalProfileDto;
  /** The id of the child just created or edited, when the profile can name it. */
  personId: string | null;
  fallback: boolean;
}

/**
 * Which child an edit is about. `personId` wherever the profile named one;
 * `index` into the profile's family only for the rare row it could not (two
 * same-named, same-year children against a Medal that sends no ids), which
 * only the list-replacing fallback can address.
 */
export interface PersonTarget {
  personId?: string | null;
  index?: number;
}

/**
 * Medal answered 409 `VIPPS_IDENTITY_CONFLICT` to a pending-link code: the code
 * was right, but this Vipps account has since been bound to another customer.
 * An answer for the login sheet — «log in with e-mail, or ring the salon».
 */
export class PortalVippsConflictError extends Error {
  constructor() {
    super('vipps identity conflict');
    this.name = 'PortalVippsConflictError';
  }
}

/** How a link grant ended: linked, bound to another profile, or not honoured. */
export type VippsLinkCompletion = 'linked' | 'conflict' | 'invalid';

type Seam = Pick<MedalSeam, 'requireMedal' | 'requireMedalWithTimeout' | 'requireMedalConfig'>;

export interface PortalSeamOptions {
  config: Pick<BookingConfig, 'paths'>;
  messages?: Partial<PortalMessages>;
}

/** The portal seam over one Medal seam. */
export function createPortalSeam(medal: Seam, options: PortalSeamOptions) {
  const messages = { ...DEFAULT_PORTAL_MESSAGES, ...options.messages };
  const { toPortalBookingDto } = createPortalDto(options.config);

  /**
   * The SDK's portal namespace (`Medal#portal`, SDK ≥ 1.8.0). `requireMedal()`
   * throws `MedalConfigError` for a missing key, and that is left to propagate:
   * a portal that silently cannot reach Medal is worse than one that fails
   * visibly.
   */
  function portalClient(): Portal {
    return medal.requireMedal().portal;
  }

  const REDACTED = '<session>';

  /** A value that must not appear in an error, and the placeholder it becomes. */
  type Secret = { value: string; label: string };

  /**
   * How far below the thrown error the scrub follows `cause` and
   * `AggregateError.errors`. Three is deeper than any chain the SDK or `fetch`
   * builds (undici wraps one `cause` under `fetch failed`), and a bound is
   * needed at all because `cause` may point back up the chain: an error that is
   * its own cause would otherwise recurse until the stack ran out.
   */
  const REDACT_DEPTH = 3;

  function scrub(text: string, session: string, label = REDACTED): string {
    return text.includes(session) ? text.split(session).join(label) : text;
  }

  /**
   * Scrub `message` and `stack` on `error` and on every `Error` hanging off it.
   *
   * `cause` and `errors` are followed because a logger prints them: Node's
   * `util.inspect`, Pino's error serializer and Sentry all walk the cause chain,
   * so a clean top-level message over an unscrubbed `cause.message` is the same
   * leak one level down. A string `cause` is rewritten in place for the same
   * reason; anything else there (a response object, say) is not a string a
   * logger prints verbatim and is left alone.
   */
  function redactError(error: Error, session: string, depth: number, label = REDACTED): void {
    if (error.message.includes(session)) error.message = scrub(error.message, session, label);
    if (typeof error.stack === 'string' && error.stack.includes(session)) {
      error.stack = scrub(error.stack, session, label);
    }
    if (depth >= REDACT_DEPTH) return;
    if (error.cause instanceof Error) {
      redactError(error.cause, session, depth + 1, label);
    } else if (typeof error.cause === 'string') {
      error.cause = scrub(error.cause, session, label);
    }
    if (error instanceof AggregateError) {
      for (const inner of error.errors) {
        if (inner instanceof Error) redactError(inner, session, depth + 1, label);
      }
    }
  }

  /**
   * Scrub `session` out of whatever was thrown, in place, and hand it back.
   *
   * In place rather than re-wrapped: callers up the stack switch on
   * `instanceof MedalApiError` and read `.status` / `.code`, and a fresh `Error`
   * would erase all three. `message` and `stack` are the two strings a logger
   * prints — on the error and, via `redactError`, on its `cause` chain;
   * `MedalApiError.details` is `readonly` and carries the engine's structured
   * body, which never echoes a request header.
   *
   * A non-`Error` throw that contains the session (a bare string, say) is
   * REPLACED — there is nothing else on it worth keeping, and nothing safe to
   * pass on.
   */
  function redactSession(error: unknown, session: string): unknown {
    return redactSecret(error, { value: session, label: REDACTED });
  }

  /** `redactSession` for any secret: the Vipps grant, the token it buys, the API key. */
  function redactSecret(error: unknown, secret: Secret): unknown {
    if (secret.value === '') return error;
    if (error instanceof Error) {
      redactError(error, secret.value, 0, secret.label);
      return error;
    }
    if (typeof error === 'string' && error.includes(secret.value)) {
      return new Error(scrub(error, secret.value, secret.label));
    }
    return error;
  }

  function isDeadSession(error: unknown): error is MedalApiError {
    return (
      error instanceof MedalApiError &&
      error.status === 401 &&
      (error.code === 'PORTAL_SESSION_REQUIRED' || error.code === 'PORTAL_SESSION_INVALID')
    );
  }

  function isThrottled(error: unknown): error is MedalApiError {
    return error instanceof MedalApiError && error.status === 429;
  }

  /**
   * Run one session-bound SDK call with the two guarantees from the module
   * comment, plus the one mapping every such call shares: a 401 that names the
   * session becomes `PortalSessionExpiredError`. Everything else is rethrown
   * redacted, for the caller to interpret or for the action's error handler to
   * turn into «something went wrong».
   */
  async function withSession<T>(session: string, call: (portal: Portal) => Promise<T>) {
    try {
      return await call(portalClient());
    } catch (error) {
      const scrubbed = redactSession(error, session);
      if (isDeadSession(scrubbed)) throw new PortalSessionExpiredError();
      throw scrubbed;
    }
  }

  /**
   * Ask Medal to e-mail a one-time code.
   *
   * Resolves on «sent» and says nothing about whether the address is known —
   * that is Medal's silence to keep, and the action above this keeps it too. A
   * 429 is the one answer translated (`PortalThrottledError`); anything else is
   * rethrown as-is, because a login page that cannot reach Medal should say so.
   */
  async function startLogin(email: string, locale: PortalLocale = 'no'): Promise<void> {
    try {
      unwrap(await portalClient().login.start({ email, locale }), '/api/v1/portal/login/start');
    } catch (error) {
      if (isThrottled(error)) throw new PortalThrottledError();
      throw error;
    }
  }

  /**
   * Exchange the code for a session. `null` for a wrong or expired code — that
   * is an answer for the form, not a failure — and the token plus Medal's own
   * expiry on success. The contact summary that rides along is dropped here:
   * the page fetches the profile with the session it has just been given, and
   * a second copy of the parent's name has no reader.
   */
  async function verifyLogin(
    email: string,
    code: string
  ): Promise<{ sessionToken: string; expiresAt: number } | null> {
    try {
      const session = unwrap(
        await portalClient().login.verify({ email, code }),
        '/api/v1/portal/login/verify'
      );
      return { sessionToken: session.session_token, expiresAt: session.expires_at };
    } catch (error) {
      if (
        error instanceof MedalApiError &&
        error.status === 401 &&
        error.code === 'PORTAL_CODE_INVALID'
      ) {
        return null;
      }
      if (isThrottled(error)) throw new PortalThrottledError();
      throw error;
    }
  }

  /**
   * Revoke the session upstream. A 401 of any flavour is swallowed: it means
   * Medal no longer honours this token, which is exactly the state a logout is
   * trying to reach. A 5xx is NOT — the token may still be live, and the caller
   * decides whether to clear the cookie anyway (it should: a cookie that stays
   * in the jar is a cookie that stays stealable).
   */
  async function logout(session: string): Promise<void> {
    try {
      await withSession(session, (portal) => portal.logout(session));
    } catch (error) {
      if (error instanceof PortalSessionExpiredError) return;
      if (error instanceof MedalApiError && error.status === 401) return;
      throw error;
    }
  }

  async function getMe(session: string): Promise<PortalProfileDto> {
    const profile = await withSession(session, async (portal) =>
      unwrap(await portal.me(session), '/api/v1/portal/me')
    );
    return toPortalProfileDto(profile);
  }

  /**
   * The engine names the code `VALIDATION_ERROR` whether it answers 400 or 422
   * (`medal-client.ts` records that the booking routes see the latter), so the
   * match is on the code alone. The message has already been through
   * `redactSession` by the time it is re-thrown here — it is bound for a form.
   */
  async function updateMe(session: string, patch: PortalProfilePatch): Promise<PortalProfileDto> {
    try {
      const profile = await withSession(session, async (portal) =>
        unwrap(await portal.updateMe(session, patch), '/api/v1/portal/me')
      );
      return toPortalProfileDto(profile);
    } catch (error) {
      if (error instanceof MedalApiError && error.code === 'VALIDATION_ERROR') {
        throw new PortalValidationError(error.message);
      }
      throw error;
    }
  }

  async function getMyBookings(
    session: string
  ): Promise<{ upcoming: PortalBookingDto[]; past: PortalBookingDto[] }> {
    const bookings = await withSession(session, async (portal) =>
      unwrap(await portal.myBookings(session), '/api/v1/portal/bookings')
    );
    return {
      upcoming: bookings.upcoming.map(toPortalBookingDto),
      past: bookings.past.map(toPortalBookingDto),
    };
  }

  /**
   * The parent's own data, as Medal exports it — snake_case and all, because
   * this is THEIR file (the GDPR right of access) and a projection would be
   * this site editorialising it. One thing is taken out: every `manage_token`
   * is nulled. A download sits in a Downloads folder, gets attached to an
   * e-mail, gets synced to a phone; a live credential for moving an appointment
   * does not belong in any of those places, and the same bookings are managed
   * from the page with the session instead.
   *
   * Copies rather than mutates: the SDK's object is nobody else's, today, but a
   * function that quietly edits its input is a bug waiting for a second reader.
   */
  async function exportMyData(session: string): Promise<PortalExport> {
    const exported = await withSession(session, async (portal) =>
      unwrap(await portal.exportMyData(session), '/api/v1/portal/export')
    );
    return {
      ...exported,
      bookings: exported.bookings.map((booking) => ({ ...booking, manage_token: null })),
    };
  }

  async function deleteMe(session: string): Promise<void> {
    await withSession(session, (portal) => portal.deleteMe(session));
  }

  /*
   * ---------------------------------------------------------------------------
   * Vipps login
   *
   * Three routes: start, exchange and (below) the pending-link verify. SDK 1.12
   * has a method for each; `exchange` and `verifyLink` go through it, because
   * both are sent exactly once there (`retry: false`) — the grant and the link
   * are single-use, so a retry would misreport a completed login — and the
   * 15 s budget is kept by a client of its own (`quickPortal`). `start` stays on
   * a raw `fetch` built from the same key and origin (`postVipps`): the SDK
   * retries it on 429/5xx with no per-call way to opt out, and this site wants
   * a throttle to surface at once as `PortalThrottledError` and an unreachable
   * Medal to fail inside the one 15 s budget, not three. Medal keeps the whole OpenID Connect exchange with
   * Vipps on its side; this site only asks for an address to send the parent to
   * and, when they come back, swaps the one-time GRANT in the return URL for a
   * session. The grant is a bearer credential for that swap — whoever presents
   * it first is logged in — so it is redacted from errors exactly like the
   * session, and the API key rides along in the same list because it is in the
   * `Authorization` header of a request `fetch` may well quote.
   *
   * Both routes answer in the platform's standard envelopes — `{ data: … }` on
   * a 2xx and `{ error: { code, message } }` otherwise — the same shapes the
   * SDK's own methods unwrap. `postVipps` mirrors that: the `data` member is
   * what it resolves with, and a 2xx WITHOUT one (a legacy bare body, an HTML
   * error page, an empty response) is a failure, not a success carrying
   * `undefined`. The `code` is what the mappings below key on, and it is kept
   * on the thrown `MedalApiError` for whoever reads the log; the `message` is
   * dropped, because a sentence written for integrators may quote the request
   * it is about, and the redaction here covers `message` and `stack`, not a
   * structured `details`.
   * ---------------------------------------------------------------------------
   */

  /** Long enough for Medal to round-trip Vipps; short enough that a parent
   * whose click went nowhere is told so before they give up on the page. */
  const VIPPS_TIMEOUT_MS = 15_000;

  /** The SDK's portal namespace on a client with the `VIPPS_TIMEOUT_MS` deadline. */
  function quickPortal(): Portal {
    return medal.requireMedalWithTimeout(VIPPS_TIMEOUT_MS).portal;
  }

  /** `body[key]`, or `undefined` for a body that is not an object. */
  function field(body: unknown, key: string): unknown {
    return body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
  }

  /** The `code` of a standard error envelope; `UNKNOWN_ERROR` for anything else. */
  function vippsErrorCode(body: unknown): string {
    const code = field(field(body, 'error'), 'code');
    return typeof code === 'string' && code !== '' ? code : 'UNKNOWN_ERROR';
  }

  /** The engine's own 404s on the persons routes; any other 404 is a missing route. */
  const DOMAIN_NOT_FOUND: ReadonlySet<string> = new Set(['Person not found', 'Resource not found']);

  function isDomainNotFound(message: unknown): boolean {
    return typeof message === 'string' && DOMAIN_NOT_FOUND.has(message);
  }

  /** A 2xx whose body is not the shape the contract promises is not a success. */
  function malformed(path: string): MedalApiError {
    return new MedalApiError(200, 'NON_JSON_BODY', `Medal returned a malformed body from ${path}`);
  }

  /**
   * `POST` one Vipps route with the API key. Resolves with the `data` member
   * of the parsed 2xx envelope; throws `MedalApiError` for anything else, with
   * a message that names the status and the code and NOT the response text —
   * the only strings Medal echoes on these routes are ones this site sent it.
   */
  async function postVipps(path: string, body: unknown): Promise<unknown> {
    return callMedal(path, { method: 'POST', body });
  }

  /**
   * One raw request to Medal with the API key — and, for the routes that act as
   * the parent, their session in `x-portal-session`, the header the SDK's own
   * portal methods use. `postVipps` is this with `POST` and no session.
   *
   * A 204 resolves `undefined`; any other 2xx has to carry the `data` member.
   */
  async function callMedal(
    path: string,
    {
      method,
      body,
      session,
    }: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; session?: string }
  ): Promise<unknown> {
    const { key, base } = medal.requireMedalConfig();
    const response = await fetch(new URL(path, base).toString(), {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        /* v8 ignore next -- defensive: no caller sends a request without a body */
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        accept: 'application/json',
        ...(session === undefined ? {} : { 'x-portal-session': session }),
      },
      /* v8 ignore next -- defensive: no caller sends a request without a body */
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(VIPPS_TIMEOUT_MS),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const code = vippsErrorCode(parsed);
      throw new MedalApiError(
        response.status,
        code,
        `Medal answered ${response.status} ${code} from ${path}`,
        // Not the engine's sentence (see above) — only whether it was one of
        // the two «no such person / resource» 404s, which is the one decision
        // that needs it: a 404 that is neither is a route this Medal lacks
        // (`isMissingRoute`).
        { domainNotFound: isDomainNotFound(field(field(parsed, 'error'), 'message')) }
      );
    }
    const data = field(parsed, 'data');
    if (data === undefined) throw malformed(path);
    return data;
  }

  /** Run `call`, scrubbing every secret in `secrets` out of whatever it throws. */
  async function withVippsSecrets<T>(secrets: () => Secret[], call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      let scrubbed = error;
      for (const secret of secrets()) scrubbed = redactSecret(scrubbed, secret);
      throw scrubbed;
    }
  }

  function apiKeySecret(): Secret[] {
    try {
      return [{ value: medal.requireMedalConfig().key, label: '<key>' }];
    } catch {
      return [];
    }
  }

  /** The start route's three decisions, by code (and 429 by status); anything else is rethrown. */
  function mapStartError(error: unknown): never {
    if (error instanceof MedalApiError) {
      if (error.code === 'VIPPS_NOT_CONFIGURED') throw new PortalVippsUnavailableError();
      if (error.code === 'INVALID_RETURN_URL') throw new PortalValidationError(error.message);
      if (error.status === 429) throw new PortalThrottledError();
    }
    throw error;
  }

  /**
   * Ask Medal where to send the parent to log in with Vipps.
   *
   * `returnUrl` is the absolute address of this site's `/min-side/vipps` route,
   * which is where Vipps — via Medal — sends the browser back with either a
   * grant or a reason. Medal checks it against the workspace's site and answers
   * 400 `INVALID_RETURN_URL` for one it does not recognise; that surfaces as
   * `PortalValidationError` because it is a configuration mistake on one side
   * or the other, not something the parent did. 503 `VIPPS_NOT_CONFIGURED`
   * means the workspace has no Vipps credentials and becomes
   * `PortalVippsUnavailableError`, which the login page turns into «use e-mail
   * instead». The address Medal hands back is checked to be HTTPS before anyone
   * is redirected to it.
   */
  async function startVippsLogin({
    returnUrl,
    browserBinding,
    locale = 'no',
  }: {
    returnUrl: string;
    /**
     * SP10: the value this site keeps in the browser-binding cookie, so a pending link
     * Medal offers can only be confirmed from this browser (`vipps-link.ts`).
     * A Medal without it ignores the key.
     */
    browserBinding?: string;
    /** The language of the code e-mail a conflicted login sends. */
    locale?: 'no' | 'en';
  }): Promise<{ authorizeUrl: string }> {
    const path = '/api/v1/portal/vipps/start';
    const secrets = (): Secret[] => [
      ...(browserBinding ? [{ value: browserBinding, label: '<binding>' }] : []),
      ...apiKeySecret(),
    ];
    return withVippsSecrets(secrets, async () => {
      const data = await postVipps(path, {
        return_url: returnUrl,
        ...(browserBinding ? { browser_binding: browserBinding } : {}),
        locale,
      }).catch(mapStartError);
      const authorizeUrl = field(data, 'authorize_url');
      if (typeof authorizeUrl !== 'string' || !authorizeUrl.startsWith('https://')) {
        throw malformed(path);
      }
      return { authorizeUrl };
    });
  }

  /**
   * Swap the grant Vipps sent the parent back with for a session. `null` when
   * Medal does not know it (404 `GRANT_NOT_FOUND` — used already, expired, or
   * minted for another workspace; the three are not distinguished, and none is
   * a failure) and the token plus expiry otherwise, in the same shape
   * `verifyLogin` returns so the route that receives it writes the cookie the
   * same way.
   *
   * The grant and, once known, the token are scrubbed from anything thrown:
   * the grant is in the request body, the token in the response, and a `fetch`
   * failure or a serialiser can quote either.
   */
  async function exchangeVippsGrant(
    grant: string
  ): Promise<{ sessionToken: string; expiresAt: number } | null> {
    const path = '/api/v1/portal/vipps/exchange';
    let token = '';
    const secrets = (): Secret[] => [
      { value: grant, label: '<grant>' },
      { value: token, label: REDACTED },
      ...apiKeySecret(),
    ];
    return withVippsSecrets(secrets, async () => {
      let data: unknown;
      try {
        data = unwrap(await quickPortal().login.vipps.exchange({ grant }), path);
      } catch (error) {
        if (error instanceof MedalApiError && error.code === 'GRANT_NOT_FOUND') return null;
        if (isThrottled(error)) throw new PortalThrottledError();
        throw error;
      }
      const sessionToken = field(data, 'session_token');
      const expiresAt = field(data, 'expires_at');
      if (typeof sessionToken === 'string') token = sessionToken;
      if (token === '' || typeof expiresAt !== 'number') throw malformed(path);
      return { sessionToken: token, expiresAt };
    });
  }

  /*
   * ---------------------------------------------------------------------------
   * Children as persons (SP10)
   *
   * `POST /api/v1/portal/me/persons`, `PATCH` and `DELETE /…/persons/{id}` edit
   * one child in place, so the id — which a booking carries as
   * `booked_for_person_id` — survives a rename. `create` and `remove` go
   * through the SDK's `portal.persons.{create,remove}` (1.12), which put the
   * session in `x-portal-session` and send each exactly once, on `quickPortal`
   * so the 15 s budget holds. `update` stays on the raw `callMedal` PATCH: the
   * SDK retries `persons.update` on 429/5xx (each attempt with its own
   * deadline) and takes no per-call `retry: false`, so a throttle would no
   * longer surface at once as `PortalThrottledError` and an unreachable Medal
   * would hold the editor for three budgets instead of one.
   *
   * FEATURE-DETECTED, because this site must keep working against a Medal that
   * does not have them: a 404 that is not the engine's own «Person not found» /
   * «Resource not found» is a route that does not exist (today's Medal answers
   * Convex's plain «No matching routes found»), and each function then falls
   * back to what the editor did before — the whole family list through
   * `PATCH /me`, which matches on name and year and so also keeps the id for a
   * child whose name and year did not change. Birth month, notes and preferred
   * stylist have nowhere to go in that fallback and are dropped; the answer
   * says so (`fallback: true`) and the editor only offers those fields where
   * `personDetails` says Medal can keep them.
   * ---------------------------------------------------------------------------
   */

  const PERSONS_PATH = '/api/v1/portal/me/persons';

  /**
   * A 404 that is not the engine's own «Person not found» / «Resource not
   * found». The SDK keeps the engine's sentence as `message`; the raw
   * `callMedal` drops it and records the verdict in `details.domainNotFound`.
   */
  function isMissingRoute(error: unknown): boolean {
    if (!(error instanceof MedalApiError) || error.status !== 404) return false;
    const details = error.details as { domainNotFound?: unknown } | undefined;
    const domain = details?.domainNotFound === true || isDomainNotFound(error.message);
    return !(error.code === 'NOT_FOUND' && domain);
  }

  /** The editor's copy for what the engine refused. Never the engine's own
   * sentence: it is written for integrators and names wire fields. */
  function mapPersonError(error: unknown): never {
    if (error instanceof MedalApiError) {
      if (error.code === 'CONFLICT') {
        throw new PortalValidationError(messages.duplicateChild);
      }
      if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_INPUT') {
        throw new PortalValidationError(messages.invalidChild);
      }
      if (error.status === 404) {
        throw new PortalValidationError(messages.childNotFound);
      }
      if (error.status === 429) throw new PortalThrottledError();
    }
    throw error;
  }

  function personPatch(input: Partial<PortalPersonInput>): PortalPersonPatch {
    const body: PortalPersonPatch = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.birthYear !== undefined) body.birth_year = input.birthYear;
    if (input.birthMonth !== undefined) body.birth_month = input.birthMonth;
    if (input.notes !== undefined) body.notes = input.notes;
    if (input.preferredResourceId !== undefined) {
      body.preferred_resource_id = input.preferredResourceId;
    }
    return body;
  }

  /**
   * On create an absent key and `null` mean the same — nothing — and the
   * create schema is STRICT about nulls it does not take.
   */
  function personCreate(input: PortalPersonInput): PortalPersonCreateInput {
    const body: PortalPersonCreateInput = { name: input.name, birth_year: input.birthYear };
    if (input.birthMonth != null) body.birth_month = input.birthMonth;
    if (input.notes != null) body.notes = input.notes;
    if (input.preferredResourceId != null) body.preferred_resource_id = input.preferredResourceId;
    return body;
  }

  /** Run one persons call with the session scrubbed and a dead one mapped. */
  async function withPersonsCall<T>(session: string, call: () => Promise<T>): Promise<T> {
    return withVippsSecrets(
      () => [{ value: session, label: REDACTED }, ...apiKeySecret()],
      async () => {
        try {
          return await call();
        } catch (error) {
          if (isDeadSession(error)) throw new PortalSessionExpiredError();
          throw error;
        }
      }
    );
  }

  function wireFamily(profile: PortalProfileDto) {
    return profile.family.map((member) => ({ name: member.name, birth_year: member.birthYear }));
  }

  /** The id the refreshed profile gives the child with this name and year. */
  function idOf(profile: PortalProfileDto, name: string, birthYear: number): string | null {
    const matches = profile.family.filter(
      (member) => member.name === name && member.birthYear === birthYear
    );
    return matches.length === 1 ? matches[0].personId : null;
  }

  /** Where a child sits in the list the fallback rewrites: by id, else by index. */
  function familyIndex(profile: PortalProfileDto, target: PersonTarget): number {
    if (target.personId) {
      return profile.family.findIndex((member) => member.personId === target.personId);
    }
    const index = target.index ?? -1;
    return index >= 0 && index < profile.family.length ? index : -1;
  }

  async function createPerson(
    session: string,
    input: PortalPersonInput
  ): Promise<PortalPersonResult> {
    const created = await withPersonsCall(session, async () => {
      try {
        const data = unwrap(
          await quickPortal().persons.create(session, personCreate(input)),
          PERSONS_PATH
        );
        const personId = field(data, 'person_id');
        return { personId: typeof personId === 'string' ? personId : null };
      } catch (error) {
        if (isMissingRoute(error)) return null;
        return mapPersonError(error);
      }
    });
    if (created !== null) {
      return { profile: await getMe(session), personId: created.personId, fallback: false };
    }
    const current = await getMe(session);
    const profile = await updateMe(session, {
      family: [...wireFamily(current), { name: input.name, birth_year: input.birthYear }],
    });
    return { profile, personId: idOf(profile, input.name, input.birthYear), fallback: true };
  }

  async function updatePerson(
    session: string,
    target: PersonTarget,
    patch: Partial<PortalPersonInput>
  ): Promise<PortalPersonResult> {
    const personId = target.personId ?? null;
    if (personId !== null) {
      const done = await withPersonsCall(session, async () => {
        try {
          await callMedal(`${PERSONS_PATH}/${encodeURIComponent(personId)}`, {
            method: 'PATCH',
            body: personPatch(patch),
            session,
          });
          return true;
        } catch (error) {
          if (isMissingRoute(error)) return false;
          return mapPersonError(error);
        }
      });
      if (done) return { profile: await getMe(session), personId, fallback: false };
    }
    const current = await getMe(session);
    const index = familyIndex(current, target);
    if (index === -1) mapPersonError(new MedalApiError(404, 'NOT_FOUND', 'person not in family'));
    const family = wireFamily(current);
    const name = patch.name ?? family[index].name;
    const birthYear = patch.birthYear ?? family[index].birth_year;
    family[index] = { name, birth_year: birthYear };
    const profile = await updateMe(session, { family });
    return { profile, personId: idOf(profile, name, birthYear), fallback: true };
  }

  async function removePerson(session: string, target: PersonTarget): Promise<PortalPersonResult> {
    const personId = target.personId ?? null;
    if (personId !== null) {
      const done = await withPersonsCall(session, async () => {
        try {
          await quickPortal().persons.remove(session, personId);
          return true;
        } catch (error) {
          if (isMissingRoute(error)) return false;
          return mapPersonError(error);
        }
      });
      if (done) return { profile: await getMe(session), personId, fallback: false };
    }
    const current = await getMe(session);
    const index = familyIndex(current, target);
    if (index === -1) mapPersonError(new MedalApiError(404, 'NOT_FOUND', 'person not in family'));
    const profile = await updateMe(session, {
      family: wireFamily(current).filter((_, position) => position !== index),
    });
    return { profile, personId, fallback: true };
  }

  /**
   * Confirm a conflicted Vipps login with the six-digit code Medal e-mailed to
   * the address on file (SP10 A5): `POST /api/v1/portal/vipps/link/verify`.
   *
   * `null` for every refusal Medal folds into 401 `PORTAL_CODE_INVALID` — a
   * wrong or burned code, an unknown, expired or spent link, a browser binding
   * that is not the one the login started with — which is one answer for the
   * form. 409 is `PortalVippsConflictError`, 429 `PortalThrottledError`.
   *
   * The link, the code, the binding and the session it buys are all scrubbed
   * from anything thrown, with the API key. Through the SDK's
   * `portal.login.vipps.verifyLink`, which sends it exactly once: the right code
   * consumes the link, so a retry would misreport a completed login.
   */
  async function verifyVippsLink({
    link,
    code,
    browserBinding,
  }: {
    link: string;
    code: string;
    /** Mandatory: Medal refuses a verify without the binding the login started with. */
    browserBinding: string;
  }): Promise<{ sessionToken: string; expiresAt: number } | null> {
    const path = '/api/v1/portal/vipps/link/verify';
    let token = '';
    const secrets = (): Secret[] => [
      { value: link, label: '<link>' },
      { value: code, label: '<code>' },
      { value: browserBinding, label: '<binding>' },
      { value: token, label: REDACTED },
      ...apiKeySecret(),
    ];
    return withVippsSecrets(secrets, async () => {
      let data: unknown;
      try {
        data = unwrap(
          await quickPortal().login.vipps.verifyLink({
            link,
            code,
            browser_binding: browserBinding,
          }),
          path
        );
      } catch (error) {
        return mapLinkError(error);
      }
      const sessionToken = field(data, 'session_token');
      const expiresAt = field(data, 'expires_at');
      if (typeof sessionToken === 'string') token = sessionToken;
      if (token === '' || typeof expiresAt !== 'number') throw malformed(path);
      return { sessionToken: token, expiresAt };
    });
  }

  /** The link verify's refusals: `null` for «wrong or expired», the two errors, else rethrown. */
  function mapLinkError(error: unknown): null {
    if (error instanceof MedalApiError) {
      if (error.status === 401 && error.code === 'PORTAL_CODE_INVALID') return null;
      if (error.status === 409 && error.code === 'VIPPS_IDENTITY_CONFLICT') {
        throw new PortalVippsConflictError();
      }
      if (error.status === 429) throw new PortalThrottledError();
    }
    throw error;
  }

  /*
   * ---------------------------------------------------------------------------
   * «Koble til Vipps» from Min side → Profil
   *
   * A parent who logged in with e-mail links their Vipps account to the profile
   * they are already in: `POST /api/v1/portal/me/vipps/link/start` (session)
   * answers with the address to send them to, and Medal's callback either says
   * `?vipps=linked` / `?vipps=link_conflict` outright or hands back a one-time
   * link GRANT that this site spends with the same session through
   * `POST /api/v1/portal/me/vipps/link/complete`. Both carry the browser
   * binding from the `__Host-` binding cookie (`core/portal/vipps-link.ts`), so a grant lifted
   * out of one browser's address bar is worthless in another's.
   *
   * FEATURE-DETECTED like the persons routes: a start that answers with a
   * missing route (`isMissingRoute`) is `null`, and the Profil row hides. Raw
   * `callMedal`, because no SDK has these yet (1.12 included).
   * TODO(sdk): use `portal.vipps.link.{start,complete}` once the SDK has them.
   * ---------------------------------------------------------------------------
   */

  const VIPPS_LINK_PATH = '/api/v1/portal/me/vipps/link';

  /** The session, the binding, the grant when there is one, and the key — scrubbed; a dead session mapped. */
  async function withVippsLinkCall<T>(
    session: string,
    extra: Secret[],
    call: () => Promise<T>
  ): Promise<T> {
    return withVippsSecrets(
      () => [{ value: session, label: REDACTED }, ...extra, ...apiKeySecret()],
      async () => {
        try {
          return await call();
        } catch (error) {
          if (isDeadSession(error)) throw new PortalSessionExpiredError();
          throw error;
        }
      }
    );
  }

  function isVippsNotConfigured(error: unknown): boolean {
    return error instanceof MedalApiError && error.code === 'VIPPS_NOT_CONFIGURED';
  }

  /**
   * Ask Medal where to send a logged-in parent to link Vipps. `null` against a
   * Medal without the route AND for a workspace without Vipps (503
   * `VIPPS_NOT_CONFIGURED`) — both hide the row, with nothing to say.
   * `PortalThrottledError` for a 429, `PortalSessionExpiredError` for a dead
   * session; the address is checked to be HTTPS.
   */
  async function startVippsLink(
    session: string,
    {
      returnUrl,
      browserBinding,
      locale = 'no',
    }: { returnUrl: string; browserBinding: string; locale?: 'no' | 'en' }
  ): Promise<{ authorizeUrl: string } | null> {
    const path = `${VIPPS_LINK_PATH}/start`;
    return withVippsLinkCall(session, [{ value: browserBinding, label: '<binding>' }], async () => {
      let data: unknown;
      try {
        data = await callMedal(path, {
          method: 'POST',
          body: { return_url: returnUrl, browser_binding: browserBinding, locale },
          session,
        });
      } catch (error) {
        // No route, or a workspace with no Vipps (503 `VIPPS_NOT_CONFIGURED`):
        // either way there is nothing to link, and the Profil row hides.
        if (isMissingRoute(error) || isVippsNotConfigured(error)) return null;
        if (isDeadSession(error)) throw error;
        return mapStartError(error);
      }
      const authorizeUrl = field(data, 'authorize_url');
      if (typeof authorizeUrl !== 'string' || !authorizeUrl.startsWith('https://')) {
        throw malformed(path);
      }
      return { authorizeUrl };
    });
  }

  /**
   * Spend the link grant Medal's callback handed back (medal-monorepo #5592).
   *
   * 200 `{ data: { status: 'linked', already_linked } }` is `linked` — a 2xx
   * without that status is malformed, not a success. 409
   * `VIPPS_IDENTITY_CONFLICT` is `conflict` (this Vipps account belongs to
   * another profile). 404 `LINK_GRANT_NOT_FOUND` — an unknown, spent, expired
   * or malformed grant, and (since the #5592 security review, which BURNS the
   * grant on it) a wrong binding or another customer's session — is `invalid`,
   * as are a 400 and a non-session 401. Every one of the three is final for
   * the grant. A dead session and a throttle are the seam's usual errors.
   */
  async function completeVippsLink(
    session: string,
    { grant, browserBinding }: { grant: string; browserBinding: string }
  ): Promise<VippsLinkCompletion> {
    const path = `${VIPPS_LINK_PATH}/complete`;
    const secrets: Secret[] = [
      { value: grant, label: '<grant>' },
      { value: browserBinding, label: '<binding>' },
    ];
    return withVippsLinkCall(session, secrets, async () => {
      try {
        const data = await callMedal(path, {
          method: 'POST',
          body: { grant, browser_binding: browserBinding },
          session,
        });
        if (field(data, 'status') !== 'linked') throw malformed(path);
        return 'linked';
      } catch (error) {
        return mapCompleteError(error);
      }
    });
  }

  /** The complete route's refusals, as `VippsLinkCompletion`; anything else is rethrown. */
  function mapCompleteError(error: unknown): VippsLinkCompletion {
    if (!(error instanceof MedalApiError)) throw error;
    // Read before the dead-session guard, which narrows `error` away.
    const { status } = error;
    // Left for `withVippsLinkCall`, which maps it to `PortalSessionExpiredError`.
    if (isDeadSession(error)) throw error;
    if (status === 409) return 'conflict';
    if (status === 400 || status === 401 || status === 404) return 'invalid';
    if (status === 429) throw new PortalThrottledError();
    throw error;
  }

  return {
    startLogin,
    verifyLogin,
    logout,
    getMe,
    updateMe,
    getMyBookings,
    exportMyData,
    deleteMe,
    startVippsLogin,
    exchangeVippsGrant,
    createPerson,
    updatePerson,
    removePerson,
    verifyVippsLink,
    startVippsLink,
    completeVippsLink,
  };
}

export type PortalSeam = ReturnType<typeof createPortalSeam>;

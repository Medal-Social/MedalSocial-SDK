import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  PortalBookings,
  PortalExport,
  PortalLoginStartInput,
  PortalLoginStartResult,
  PortalProfile,
  PortalProfilePatch,
  PortalSession,
  PortalVerifyInput,
  PortalVippsExchangeInput,
  PortalVippsSession,
  PortalVippsStart,
  PortalVippsStartInput,
} from "../types/portal";

/** The per-request options a session-bound portal call sends. */
function withSession(session: string): { headers: Record<string, string> } {
  return { headers: { "x-portal-session": session } };
}

/**
 * For calls whose first attempt may have SUCCEEDED while the response was
 * lost: verifying burns the code, logout and deleteMe revoke the session. An
 * automatic retry would then meet `PORTAL_CODE_INVALID` /
 * `PORTAL_SESSION_INVALID` and report a completed operation as a failure, so
 * these go to the wire exactly once. A 5xx surfaces as-is; the caller decides.
 */
const ONCE = { retry: false } as const;

/**
 * E-mail one-time-code login.
 *
 * Both routes are plain POSTs — deliberately not idempotency-keyed. A start
 * that is retried sends at most one more code, and a verify that is retried
 * meets a code that has already been burned and answers
 * `PORTAL_CODE_INVALID` — neither can duplicate anything.
 */
class PortalLogin {
  /** "Log in with Vipps" (SP8a) — `start` then `exchange`. */
  readonly vipps: PortalVippsLogin;

  constructor(private client: BaseClient) {
    this.vipps = new PortalVippsLogin(client);
  }

  /**
   * E-mail a one-time code to the address.
   *
   * Always 202 `{ status: "sent" }` — enumeration-safe: `"sent"` does not
   * confirm that the address belongs to a contact. Rate-limited per address
   * and per caller (`429 RATE_LIMITED`).
   */
  async start(input: PortalLoginStartInput): Promise<ApiResponse<PortalLoginStartResult>> {
    return this.client.post("/api/v1/portal/login/start", input);
  }

  /**
   * Exchange the e-mailed code for a session.
   *
   * `session_token` is a bearer credential for ONE contact — keep it in an
   * HttpOnly cookie on the site's server. A wrong, burned or expired code all
   * answer `401 PORTAL_CODE_INVALID`; the three are not distinguished, so the
   * response is not an oracle for which codes exist.
   */
  async verify(input: PortalVerifyInput): Promise<ApiResponse<PortalSession>> {
    return this.client.post("/api/v1/portal/login/verify", input, ONCE);
  }
}

/**
 * "Log in with Vipps" (SP8a) — the two calls your server makes; the third leg
 * is the customer's browser.
 *
 * 1. {@link start} with the page you want them back on, and redirect them to
 *    `authorize_url`.
 * 2. Vipps sends them to Medal's callback, which redirects to your `return_url`
 *    with either `?grant=…` or `?vipps=needs_email_login` / `?vipps=failed` —
 *    fall back to {@link PortalLogin.start} on those two.
 * 3. {@link exchange} the grant, server-side, for a session token.
 *
 * `503 VIPPS_NOT_CONFIGURED` means this deployment has no Vipps login
 * configured: the e-mail code flow is the way in.
 */
class PortalVippsLogin {
  constructor(private client: BaseClient) {}

  /**
   * Begin a Vipps login and get the URL to send the customer to.
   *
   * `return_url` must be an `https` URL under one of the workspace's own sites
   * (`400 INVALID_RETURN_URL` otherwise) — the allow-list is the salon's site
   * origins, so a login cannot be bounced to somebody else's page. The answer
   * carries a one-time `state`: never cache `authorize_url`, start again.
   */
  async start(input: PortalVippsStartInput): Promise<ApiResponse<PortalVippsStart>> {
    return this.client.post("/api/v1/portal/vipps/start", input);
  }

  /**
   * Exchange the callback's one-time `grant` for a portal session. Call this
   * from your SERVER and keep `session_token` in an HttpOnly cookie.
   *
   * Sent exactly once: the grant is consumed by the first attempt, so an
   * automatic retry would meet `404 GRANT_NOT_FOUND` and report a completed
   * login as a failure. A 5xx surfaces as-is; start a new login.
   */
  async exchange(input: PortalVippsExchangeInput): Promise<ApiResponse<PortalVippsSession>> {
    return this.client.post("/api/v1/portal/vipps/exchange", input, ONCE);
  }
}

/**
 * One customer's session, with the token already bound.
 *
 * `medal.portal.session(token)` exists because the flat methods take the token
 * as their FIRST positional argument — `updateMe(session, patch)` — and a
 * `updateMe(patch, session)` mix-up type-checks whenever both are strings. Bind
 * once and the rest of the flow reads as what it is: `me.update({ … })`.
 *
 * Every method here forwards to the flat twin, so behaviour (including which
 * calls are sent exactly once) is identical.
 */
export class PortalSessionScope {
  constructor(
    private portal: Portal,
    /** The session token this scope is bound to. */
    readonly token: string,
  ) {}

  /** The signed-in contact's own profile. See {@link Portal.me}. */
  async profile(): Promise<ApiResponse<PortalProfile>> {
    return this.portal.me(this.token);
  }

  /** Update the profile. See {@link Portal.updateMe}. */
  async update(patch: PortalProfilePatch): Promise<ApiResponse<PortalProfile>> {
    return this.portal.updateMe(this.token, patch);
  }

  /** The contact's bookings, split around now. See {@link Portal.myBookings}. */
  async bookings(): Promise<ApiResponse<PortalBookings>> {
    return this.portal.myBookings(this.token);
  }

  /** The contact's own GDPR export. See {@link Portal.exportMyData}. */
  async export(): Promise<ApiResponse<PortalExport>> {
    return this.portal.exportMyData(this.token);
  }

  /** Erase the contact. See {@link Portal.deleteMe}. */
  async delete(): Promise<void> {
    return this.portal.deleteMe(this.token);
  }

  /** Revoke the session. See {@link Portal.logout}. */
  async logout(): Promise<void> {
    return this.portal.logout(this.token);
  }
}

/**
 * Customer self-service portal. The session token is a bearer credential for a
 * single contact: the calling site server must keep it in an HttpOnly cookie
 * and never hand it to the browser. Session-bound methods send it as
 * `X-Portal-Session`; none of them carries an `Idempotency-Key`.
 *
 * The API key needs `read:portal` and `write:portal` (`403 FORBIDDEN`
 * otherwise). A missing header answers `401 PORTAL_SESSION_REQUIRED`; an
 * unknown, expired or revoked token answers `401 PORTAL_SESSION_INVALID` —
 * treat both as "sign in again".
 */
export class Portal {
  /** E-mail one-time-code login: `start` sends the code, `verify` exchanges it. */
  readonly login: PortalLogin;

  constructor(private client: BaseClient) {
    this.login = new PortalLogin(client);
  }

  /**
   * Bind a session token once, then call the self-service methods without
   * repeating it:
   *
   * ```ts
   * const me = medal.portal.session(sessionToken);
   * const { data: profile } = await me.profile();
   * await me.update({ phone: "+4790000000" });
   * ```
   *
   * The flat, session-first methods stay exactly as they are — this is an
   * additive convenience, not a replacement.
   */
  session(token: string): PortalSessionScope {
    return new PortalSessionScope(this, token);
  }

  /**
   * Revoke the session. Resolves to `undefined` (the route answers 204).
   *
   * Not keyed: revoking twice reaches the same state — the second call answers
   * `401 PORTAL_SESSION_INVALID`, which is the outcome you wanted anyway.
   */
  async logout(session: string): Promise<void> {
    await this.client.post("/api/v1/portal/logout", undefined, {
      ...withSession(session),
      ...ONCE,
    });
  }

  /** The signed-in contact's own profile. */
  async me(session: string): Promise<ApiResponse<PortalProfile>> {
    return this.client.get("/api/v1/portal/me", undefined, withSession(session));
  }

  /**
   * Update the signed-in contact's profile. Only the supplied fields change;
   * `phone: null` clears the number and `family` replaces the whole list.
   * `marketing_consent` records a `marketing_email` consent decision with
   * source `portal`. Returns the profile as it is after the change.
   */
  /**
   * A profile patch is not idempotency-keyed on the server and a `marketing_consent`
   * change records a dated consent event, so a retry after a committed-but-lost
   * response would repeat that event: sent exactly once, like the other writes.
   */
  async updateMe(session: string, patch: PortalProfilePatch): Promise<ApiResponse<PortalProfile>> {
    return this.client.patch("/api/v1/portal/me", patch, { ...withSession(session), ...ONCE });
  }

  /**
   * The contact's bookings split into `upcoming` and `past`. An upcoming
   * booking that is still inside the workspace's policy windows carries
   * `manage_token` and `can_manage: true`; use the token to open the site's
   * manage page (`medal.bookings.manage.*`).
   */
  async myBookings(session: string): Promise<ApiResponse<PortalBookings>> {
    return this.client.get("/api/v1/portal/me/bookings", undefined, withSession(session));
  }

  /**
   * Everything the workspace holds about the contact — profile, family,
   * consents and bookings — as one JSON document (GDPR Art. 15). Synchronous,
   * unlike `medal.gdpr.requestExport()`, which exports the whole workspace.
   *
   * Not keyed: a read-only snapshot, so a retried call costs nothing and
   * duplicates nothing.
   */
  async exportMyData(session: string): Promise<ApiResponse<PortalExport>> {
    return this.client.post("/api/v1/portal/me/export", undefined, withSession(session));
  }

  /**
   * Erase the contact (GDPR Art. 17). Resolves to `undefined` (the route
   * answers 204); the session is revoked as part of the deletion.
   *
   * Not keyed: deletion is terminal, so a retry meets a revoked session and
   * answers `401 PORTAL_SESSION_INVALID` rather than deleting anything else.
   */
  async deleteMe(session: string): Promise<void> {
    await this.client.post("/api/v1/portal/me/delete", undefined, {
      ...withSession(session),
      ...ONCE,
    });
  }
}

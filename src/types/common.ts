/** Successful API response wrapper */
export interface ApiResponse<T> {
  data: T;
}

/** Paginated API response */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
  };
}

/**
 * The failure codes the Medal API throws, as `error.code` on a 4xx/5xx body.
 *
 * Branch on the CODE, never on `message`: the message is prose and may be
 * reworded, the code is the contract. Kept as a union for autocomplete and
 * paired with `(string & {})` wherever it is used, because a new code is an
 * additive server change — treat an unknown one as a generic failure of its
 * HTTP status rather than a bug.
 *
 * The list mirrors what the API's handlers actually throw (and the
 * `x-medal-error-codes` extension in the OpenAPI document). A few are worth
 * knowing by name:
 *
 * - `IDEMPOTENCY_IN_PROGRESS` — the first attempt under this key is still
 *   running: wait and re-read, do not send a new key.
 * - `IDEMPOTENCY_KEY_CONFLICT` — the same key was used for a DIFFERENT request.
 * - `CAPABILITY_CONFIRMATION_REQUIRED` (428) — a capability-scoped credential
 *   needs an `X-Capability-Confirmation`; see `autoConfirmCapabilities`.
 * - `PORTAL_CODE_INVALID` / `PORTAL_SESSION_INVALID` — sign the customer in
 *   again; the two are not distinguished on purpose.
 * - `INVALID_RETURN_URL` — the URL is not under one of the workspace's sites.
 * - `CONVERSATION_NOT_LINKABLE` — a group thread, or a channel with no stable
 *   sender.
 */
export type MedalErrorCode =
  | "AI_GENERATION_FAILED"
  | "AI_QUOTA_EXCEEDED"
  | "CAPABILITY_API_PATH_INVALID"
  | "CAPABILITY_API_PATH_REQUIRED"
  | "CAPABILITY_CONFIRMATION_REQUIRED"
  | "CAPABILITY_NOT_API_BACKED"
  | "CAPABILITY_NOT_CONFIRMABLE"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_PATH_PARAM_REQUIRED"
  | "CAPABILITY_SCOPE_DENIED"
  | "CONFIRMATION_CONTEXT_MISMATCH"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_MALFORMED"
  | "CONFLICT"
  | "CONTACT_NOT_FOUND"
  | "CONVERSATION_NOT_LINKABLE"
  | "FORBIDDEN"
  | "GRANT_NOT_FOUND"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "INTERNAL_ERROR"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_INPUT"
  | "INVALID_OAUTH_RESOURCE"
  | "INVALID_RETURN_URL"
  | "NOT_FOUND"
  | "PILOT_ASK_FAILED"
  | "PORTAL_CODE_INVALID"
  | "PORTAL_SESSION_INVALID"
  | "PORTAL_SESSION_REQUIRED"
  | "PREVIEW_RECEIPT_REQUIRED"
  | "RATE_LIMITED"
  | "SEND_FAILED"
  | "UNAUTHORIZED"
  | "UPSTREAM_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "VIPPS_NOT_CONFIGURED"
  /** The SDK's own code for a response that carried no structured error. */
  | "UNKNOWN_ERROR"
  /** The deadline elapsed — see {@link MedalTimeoutError}. */
  | "TIMEOUT"
  /** No response was produced — see {@link MedalNetworkError}. */
  | "NETWORK";

/**
 * Base class for every failure this SDK throws.
 *
 * A call can fail three ways: the API answered with an error status
 * ({@link MedalApiError}), the deadline elapsed ({@link MedalTimeoutError}), or
 * the request never reached Medal at all ({@link MedalNetworkError}). The last
 * two used to surface as a raw `AbortError` / `TypeError` from `fetch`, so
 * `catch (e) { if (e instanceof MedalApiError) … }` silently skipped the two
 * most common operational failures. Narrow on this to cover all three, then on
 * `code` (or `instanceof MedalApiError`) to tell them apart.
 */
export class MedalError extends Error {
  /**
   * Machine-readable failure code — the API's `error.code`, or `TIMEOUT` /
   * `NETWORK` for the two failures that never reach the API.
   *
   * Typed as the {@link MedalErrorCode} union widened with `string`, so
   * comparing against a known code autocompletes while a code the server adds
   * later still arrives intact rather than being a type error.
   */
  readonly code: MedalErrorCode | (string & {});

  constructor(code: MedalErrorCode | (string & {}), message: string) {
    super(message);
    this.name = "MedalError";
    this.code = code;
  }
}

/** Transport-level facts about the response that failed. */
export interface MedalApiErrorMeta {
  /**
   * The `X-Request-ID` header of the failing response. Every Medal API
   * response carries one; quote it to support and the exact request can be
   * found in Medal's logs. `null` when the response carried no header (a
   * proxy error page, say).
   */
  requestId?: string | null;
  /**
   * The response's `Retry-After`, in milliseconds. Set on `429` and on the
   * `503`s that name a retry window; `null` when the header was absent or
   * unparseable. Both wire forms are understood — delay-seconds and HTTP-date.
   */
  retryAfterMs?: number | null;
}

/** API error thrown by the client */
export class MedalApiError extends MedalError {
  readonly status: number;
  readonly details?: unknown;
  /** See {@link MedalApiErrorMeta.requestId}. */
  readonly requestId: string | null;
  /** See {@link MedalApiErrorMeta.retryAfterMs}. */
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    code: MedalErrorCode | (string & {}),
    message: string,
    details?: unknown,
    meta?: MedalApiErrorMeta,
  ) {
    super(code, message);
    this.name = "MedalApiError";
    this.status = status;
    this.details = details;
    this.requestId = meta?.requestId ?? null;
    this.retryAfterMs = meta?.retryAfterMs ?? null;
  }
}

/**
 * The per-attempt deadline (`timeout`, default 30 s) elapsed before the
 * response body was in hand.
 *
 * Distinct from a caller's own `AbortSignal`: cancelling through that rejects
 * with the abort reason you supplied, unchanged, because "the user navigated
 * away" is not a Medal failure and must not be reported as one.
 */
export class MedalTimeoutError extends MedalError {
  declare readonly code: "TIMEOUT";
  /** The budget that elapsed, in milliseconds. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message: string = `Request timed out after ${timeoutMs}ms`) {
    super("TIMEOUT", message);
    this.name = "MedalTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The request never produced a response: DNS failure, TLS failure, connection
 * reset, offline browser. `fetch` reports all of these as a bare `TypeError`,
 * which says nothing about whether the write happened — for a keyed write the
 * SDK retries first (the key makes the retry a replay), and only a failure
 * that outlives the retries reaches you here.
 */
export class MedalNetworkError extends MedalError {
  declare readonly code: "NETWORK";

  constructor(message: string, options?: { cause?: unknown }) {
    super("NETWORK", message);
    this.name = "MedalNetworkError";
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

/** Pagination options for list endpoints */
export interface PaginationOptions {
  limit?: number;
  cursor?: string;
}

/**
 * A timestamp on the way IN to a list filter: Unix milliseconds, or an ISO
 * 8601 date-time string. The API normalises both to milliseconds; anything
 * else is a `400 VALIDATION_ERROR`.
 */
export type TimestampInput = number | string;

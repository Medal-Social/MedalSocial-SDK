import type { AutoConfirmOptions } from "./types/capabilities";
import type { PaginatedResponse } from "./types/common";
import { MedalApiError, MedalNetworkError, MedalTimeoutError } from "./types/common";

/** Configuration for the low-level HTTP client. */
export interface ClientConfig {
  baseUrl: string;
  token: string;
  workspaceId?: string;
  timeout: number;
  userAgent: string;
}

/** Per-request options. `headers` applies to every verb; the named options only matter on writes. */
export interface RequestOptions {
  /**
   * Idempotency key sent as the `Idempotency-Key` header. Retries with the
   * same key return the original result instead of repeating the operation.
   * Required by some endpoints for capability-scoped tokens (e.g. helpdesk
   * replies, webhook creation).
   */
  idempotencyKey?: string;
  /**
   * Capability confirmation token sent as the `X-Capability-Confirmation`
   * header. Required alongside `idempotencyKey` when a token granted a
   * capability-style scope directly (e.g. `helpdesk.webhook.manage`) executes
   * a confirmable write route. Obtain one from
   * `POST /api/v1/capability-confirmations`. API keys with legacy scopes do
   * not need it.
   */
  capabilityConfirmation?: string;
  /**
   * Opt in to (or out of) automatic capability confirmation for this call.
   *
   * Supply `{ previewSummary }` to have the SDK mint the idempotency key and
   * the `X-Capability-Confirmation` token itself; pass `false` to suppress a
   * client-level `autoConfirmCapabilities` default. Defaults to the client
   * setting, which itself defaults to OFF.
   *
   * Auto-confirmation sends `user_approved: true` on your behalf, asserting
   * that a human on your side approved this exact action — only use it where
   * that is true.
   *
   * Ignored on routes that do not require a capability confirmation.
   */
  autoConfirm?: AutoConfirmOptions | false;
  /**
   * Set to `false` to send the request exactly once — no automatic retry on
   * 429/5xx. Use it for writes whose FIRST attempt may have succeeded even
   * though the response was lost: a one-time code that is burned on use, a
   * logout or erasure that revokes the very credential a retry would present.
   * A retry there does not repeat the operation, it misreports it as failed.
   * Defaults to `true`.
   */
  retry?: boolean;
  /**
   * Extra request headers, e.g. `x-portal-session` for the customer portal.
   * Applied first: the named options (`idempotencyKey`,
   * `capabilityConfirmation`) win over a same-named entry here, so a bag can
   * never smuggle in a key the SDK did not resolve.
   */
  headers?: Record<string, string>;
  /**
   * Your own cancellation signal — a React effect cleanup, a closing request,
   * a user who navigated away. It is merged with the client's per-attempt
   * `timeout`, and it also interrupts a retry that is waiting out its backoff,
   * so an abandoned call stops costing time immediately.
   *
   * Aborting rejects with YOUR abort reason unchanged (an `AbortError` by
   * default), never with {@link MedalTimeoutError} — cancelling is not a Medal
   * failure and must not be reported as one.
   */
  signal?: AbortSignal;
}

/** First backoff step, doubled per attempt. */
const RETRY_BASE_DELAY_MS = 250;
/** Fraction of the backoff each attempt is spread over, either way. */
const RETRY_JITTER_RATIO = 0.25;

/**
 * How long to wait before attempt `attempt + 1`: exponential, spread ±25%.
 *
 * The jitter is the point. Every client that a single 503 knocked back used to
 * wait exactly 250 ms and then 500 ms, so a fleet retried in lock-step and hit
 * the recovering server as one wave — the behaviour that turns a blip into an
 * outage. `random` is injectable so the spread can be asserted rather than
 * hoped for.
 *
 * @param attempt 1-based number of the attempt that just failed.
 * @param random Uniform `[0, 1)` source; defaults to `Math.random`.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const jitter = base * RETRY_JITTER_RATIO * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * `Retry-After` in milliseconds, or `null` when the header is absent or makes
 * no sense.
 *
 * RFC 9110 allows BOTH forms and Medal's own 429s send delay-seconds, but a
 * proxy or WAF in front of an integrator's egress may answer with an
 * HTTP-date. Reading only the numeric form turned those into "no header",
 * which silently replaced a server-specified wait with the SDK's own backoff.
 *
 * A date already in the past clamps to `0` rather than going negative, so a
 * clock skew cannot make the SDK wait "forever ago".
 */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // RFC 9110's delay-seconds is a non-negative integer, but accept a decimal
  // too: a proxy that answers `1.5` means a second and a half, and reading that
  // as "no header" would replace a server-specified wait with our own guess.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * The reason an aborted signal carries.
 *
 * Per spec `abort()` always leaves a reason behind (a DOM `AbortError` when the
 * caller supplied none), so the fallback is for runtimes that predate that —
 * unreachable on every engine the test suite can run, hence ignored for
 * coverage rather than pretended to be tested.
 */
function abortReason(signal: AbortSignal): unknown {
  /* v8 ignore next -- unreachable: a spec-compliant abort() always sets a reason */
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

/**
 * A `TypeError` is how `fetch` reports "the request never produced a
 * response" — DNS, TLS, connection reset, offline. Anything else thrown out of
 * `fetch` is a programming error and must not be dressed up as a network
 * failure.
 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Walk every page of a cursor-paginated endpoint, yielding one row at a time.
 *
 * ```ts
 * for await (const contact of medal.contacts.iter({ status: "lead" })) {
 *   await sync(contact);
 * }
 * ```
 *
 * The loop is driven off `pagination.has_more`, never off the row count — the
 * API applies several filters WITHIN a page (helpdesk channels, connect-link
 * status), so a page can legitimately be short or even empty while more pages
 * remain. Stopping when the rows run out is the trap this exists to remove; the
 * README used to print the six-line cursor loop for every caller to re-derive.
 *
 * A `has_more` with no `next_cursor` ends the walk rather than re-requesting
 * page one forever.
 *
 * Rows are yielded lazily, one page at a time: `break` out of the loop and no
 * further page is fetched.
 */
export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<PaginatedResponse<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const row of page.data) yield row;
    if (!page.pagination.has_more) return;
    const next = page.pagination.next_cursor;
    if (!next) return;
    cursor = next;
  }
}

/**
 * Plain sleep. Exported for the poll helpers (`scan.waitForResult`,
 * `bookings.payment.waitForSettlement`) so there is ONE of these in the SDK
 * rather than a copy per resource; not re-exported from the package entry.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sleep, but wake early (and reject) if the caller's signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A fresh idempotency key for one logical write.
 *
 * `crypto.randomUUID` is gated to secure contexts in browsers, so a page
 * served over http:// has `crypto` but not `randomUUID`. `getRandomValues` is
 * available in every context, so fall back to assembling a v4 UUID by hand
 * rather than letting a write go out unkeyed — an unkeyed write is exactly the
 * one a retry can duplicate.
 */
function randomIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The `Idempotency-Key` one logical write goes out under: the caller's if they
 * supplied a usable one, otherwise a fresh key.
 *
 * A blank key counts as NO key. `??` alone would treat `""` as supplied,
 * {@link BaseClient} would then drop the falsy value, and the write would go
 * out with no header at all — silently unprotected, which is the one failure
 * this exists to rule out. Whitespace-only is the same hazard by a different
 * route: header values are stripped in transit, so `"   "` reaches the server
 * as `""` and is ignored there too. Both are reachable from an ordinary
 * `idempotencyKey: someVar` where the variable happens to be blank.
 *
 * Every part of the SDK that decides which key a write carries resolves it
 * here, so those parts cannot disagree. A capability confirmation is bound to
 * its idempotency key: bind one value, send another, and the server rejects a
 * write both sides believed they had authorized.
 */
export function resolveIdempotencyKey(supplied?: string): string {
  return (supplied ?? "").trim() || randomIdempotencyKey();
}

/**
 * Low-level HTTP client used by all resource classes.
 * Handles authentication, retries, timeout, and error parsing.
 */
export class BaseClient {
  /** Resolved client configuration. */
  readonly config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  /** Execute an authenticated GET request and return the parsed JSON body. */
  async get<T>(
    path: string,
    params?: Record<string, string | undefined>,
    options?: Pick<RequestOptions, "headers" | "signal" | "retry">,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: "GET", headers: options?.headers }, options);
  }

  /** Execute an authenticated POST request with a JSON body. */
  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(
      this.buildUrl(path),
      {
        method: "POST",
        headers: this.writeHeaders(options),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      options,
    );
  }

  /**
   * Execute a POST that must never execute twice, guaranteeing an
   * `Idempotency-Key`.
   *
   * {@link BaseClient.post} retries 429 and 5xx automatically, so a write
   * whose transaction committed before the gateway failed would otherwise be
   * submitted a second time — booking the same slot twice. A key turns that
   * retry into a replay: the server keys on the key, the workspace, and the
   * method+path, and answers a repeat with the stored response, or 409 while
   * the first attempt is still in flight. Either way the write happens once.
   *
   * The key is minted ONCE here, outside the retry loop in `request`, so every
   * attempt of the same logical call carries the same value — a key minted per
   * attempt would deduplicate nothing. A caller-supplied key always wins, so
   * callers keeping their own records stay in control. See
   * {@link resolveIdempotencyKey} for what counts as supplied.
   */
  async postOnce<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.post(path, body, {
      ...options,
      idempotencyKey: resolveIdempotencyKey(options?.idempotencyKey),
    });
  }

  /** Execute an authenticated PUT request with a JSON body. */
  async put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(
      this.buildUrl(path),
      {
        method: "PUT",
        headers: this.writeHeaders(options),
        body: JSON.stringify(body),
      },
      options,
    );
  }

  /** Execute an authenticated PATCH request with a JSON body. */
  async patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(
      this.buildUrl(path),
      {
        method: "PATCH",
        headers: this.writeHeaders(options),
        body: JSON.stringify(body),
      },
      options,
    );
  }

  /** Execute an authenticated DELETE request. */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(
      this.buildUrl(path),
      {
        method: "DELETE",
        headers: this.writeHeaders(options),
      },
      options,
    );
  }

  private writeHeaders(options?: RequestOptions): Record<string, string> {
    // Lower-case the bag's keys first. A plain object is case-sensitive but
    // `Headers` is not: `{ "Content-Type": "text/plain", "content-type":
    // "application/json" }` would reach the wire as BOTH values joined, so a
    // capitalised bag entry could smuggle past the protected names below.
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(options?.headers ?? {})) {
      headers[key.toLowerCase()] = value;
    }
    headers["content-type"] = "application/json";
    if (options?.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }
    if (options?.capabilityConfirmation) {
      headers["x-capability-confirmation"] = options.capabilityConfirmation;
    }
    return headers;
  }

  private buildUrl(path: string, params?: Record<string, string | undefined>): string {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    control?: Pick<RequestOptions, "retry" | "signal">,
  ): Promise<T> {
    const maxAttempts = control?.retry === false ? 1 : 3;
    const callerSignal = control?.signal;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Checked before every attempt, including the first: a signal that was
      // already aborted must not open a connection at all.
      if (callerSignal?.aborted) throw abortReason(callerSignal);

      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${this.config.token}`);
      if (this.config.workspaceId) {
        headers.set("x-workspace-id", this.config.workspaceId);
      }
      try {
        headers.set("user-agent", this.config.userAgent);
      } catch {
        // Browsers disallow setting user-agent
      }

      // A network failure is only safe to repeat when repeating it cannot
      // duplicate anything: a GET, or a write that carries an
      // `Idempotency-Key` the server replays on. An unkeyed POST stays
      // single-shot — "the connection dropped" says nothing about whether the
      // write committed.
      const replayable = init.method === "GET" || headers.has("idempotency-key");

      const controller = new AbortController();
      // Armed across the body read, not just the fetch. `fetch` settles as soon
      // as the response HEADERS arrive, so a timer cleared there bounded only
      // time-to-headers: a server that sent headers and then stalled mid-body
      // left the reads below waiting forever, with no deadline of any kind.
      // Holding the signal until the body is in hand makes `timeout` mean what
      // it says — a budget for the whole exchange, per attempt.
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);
      let timedOut = false;
      const onTimeout = () => {
        timedOut = true;
      };
      controller.signal.addEventListener("abort", onTimeout, { once: true });
      // The caller's cancellation is forwarded into the SAME controller the
      // deadline uses, rather than merged with `AbortSignal.any` (not present
      // in every runtime this SDK supports). That sets `timedOut` as well — it
      // is one abort event either way — so the catch below checks the caller's
      // signal FIRST, and that ordering is what keeps a cancellation from being
      // reported as a timeout.
      const onCallerAbort = () => controller.abort(abortReason(callerSignal as AbortSignal));
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

      let res: Response;
      let text = "";
      let retrying = false;
      try {
        res = await fetch(url, { ...init, headers, signal: controller.signal });

        // Retry on 429 / 5xx (but not on the final attempt)
        retrying =
          (res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < maxAttempts;

        if (retrying) {
          // Release the response we are about to abandon. Until a body is
          // consumed, undici holds its socket out of the connection pool, so a
          // retry storm burns a fresh connection per attempt — exactly when the
          // server can least afford it.
          //
          // Consuming returns the socket to the pool. `res.body?.cancel()` frees
          // it too, but by destroying the connection rather than reusing it,
          // which is the churn this exists to avoid. Pipe to a sink rather than
          // `res.text()`: an error body can be arbitrarily large, and buffering
          // one into a string only to discard it costs several times its size in
          // memory on every attempt of every in-flight request.
          //
          // Fall back to `text()` where there is no stream to pipe: a bodyless
          // response, or a runtime that exposes `text()` but not `body`.
          const drained = res.body ? res.body.pipeTo(new WritableStream()) : res.text();

          // A read that fails — including one the deadline above aborts — has
          // already released the socket, so a failure here is not worth
          // propagating over the status we are retrying on.
          await drained.catch(() => {});
        } else {
          text = await res.text();
        }
      } catch (error) {
        // The caller's own cancellation wins over every classification below:
        // it is their reason, and reporting it as a Medal failure would make an
        // abandoned page look like an outage.
        if (callerSignal?.aborted) throw abortReason(callerSignal);
        if (timedOut) throw new MedalTimeoutError(this.config.timeout);
        if (isNetworkFailure(error) && replayable && attempt < maxAttempts) {
          await delay(backoffDelayMs(attempt), callerSignal);
          continue;
        }
        if (isNetworkFailure(error)) {
          throw new MedalNetworkError(
            `Request to ${new URL(url).pathname} failed before a response was received`,
            { cause: error },
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onTimeout);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      }

      if (retrying) {
        // Outside the deadline above: the backoff is time we choose to wait,
        // not time we are waiting on the server. A server-specified
        // `Retry-After` wins over our own guess; `0` (or a date already past)
        // means "no useful window", so fall back to the jittered backoff.
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        const delayMs =
          retryAfterMs !== null && retryAfterMs > 0 ? retryAfterMs : backoffDelayMs(attempt);
        await delay(delayMs, callerSignal);
        continue;
      }

      // Parse response
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }

      if (!res.ok) {
        const body = parsed as
          | { error?: string | { code?: string; message?: string; details?: unknown } }
          | undefined;
        // `/api/v1/` answers `{ error: { code, message } }`. The routes that
        // predate it — `/api/cookie-consent` and friends — answer
        // `{ success: false, error: "why" }` with a plain string. Reading only
        // the object form turned every one of those into "HTTP 403: Error",
        // so the caller could not tell an unowned domain from a bad key.
        const detail = typeof body?.error === "string" ? body.error : undefined;
        const structured = typeof body?.error === "object" ? body.error : undefined;
        throw new MedalApiError(
          res.status,
          structured?.code ?? "UNKNOWN_ERROR",
          detail ?? structured?.message ?? `HTTP ${res.status}: ${res.statusText}`,
          structured?.details,
          {
            // Every Medal API response carries `X-Request-ID`; it is the only
            // handle support has on one specific call, and reading the body
            // alone threw it away.
            requestId: res.headers.get("x-request-id"),
            retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
          },
        );
      }

      return parsed as T;
    }

    /* v8 ignore next -- unreachable: loop always returns or throws */
    throw new Error("Request failed after retries");
  }
}

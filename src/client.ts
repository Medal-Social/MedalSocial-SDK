import type { AutoConfirmOptions } from "./types/capabilities";
import { MedalApiError } from "./types/common";

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
    options?: Pick<RequestOptions, "headers">,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: "GET", headers: options?.headers });
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
      options?.retry,
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

  /** Execute an authenticated PATCH request with a JSON body. */
  async patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "PATCH",
      headers: this.writeHeaders(options),
      body: JSON.stringify(body),
    });
  }

  /** Execute an authenticated DELETE request. */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "DELETE",
      headers: this.writeHeaders(options),
    });
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

  private async request<T>(url: string, init: RequestInit, retry = true): Promise<T> {
    const maxAttempts = retry ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

      const controller = new AbortController();
      // Armed across the body read, not just the fetch. `fetch` settles as soon
      // as the response HEADERS arrive, so a timer cleared there bounded only
      // time-to-headers: a server that sent headers and then stalled mid-body
      // left the reads below waiting forever, with no deadline of any kind.
      // Holding the signal until the body is in hand makes `timeout` mean what
      // it says — a budget for the whole exchange, per attempt.
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

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
      } finally {
        clearTimeout(timeout);
      }

      if (retrying) {
        const retryAfter = res.headers.get("retry-after");
        let delayMs = 0;
        if (retryAfter) {
          const seconds = Number(retryAfter);
          delayMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
        }
        if (delayMs <= 0) {
          delayMs = 250 * attempt;
        }
        // Outside the deadline above: the backoff is time we choose to wait,
        // not time we are waiting on the server.
        await new Promise((r) => setTimeout(r, delayMs));
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
          | { error?: { code?: string; message?: string; details?: unknown } }
          | undefined;
        throw new MedalApiError(
          res.status,
          body?.error?.code ?? "UNKNOWN_ERROR",
          body?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
          body?.error?.details,
        );
      }

      return parsed as T;
    }

    /* v8 ignore next -- unreachable: loop always returns or throws */
    throw new Error("Request failed after retries");
  }
}

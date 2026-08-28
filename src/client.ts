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

/** Per-request options for write operations. */
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
  async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: "GET" });
  }

  /** Execute an authenticated POST request with a JSON body. */
  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "POST",
      headers: this.writeHeaders(options),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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
    const headers: Record<string, string> = { "content-type": "application/json" };
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

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const maxAttempts = 3;

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
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      let res: Response;
      try {
        res = await fetch(url, { ...init, headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      // Retry on 429 / 5xx (but not on the final attempt)
      if (
        (res.status === 429 || (res.status >= 500 && res.status <= 599)) &&
        attempt < maxAttempts
      ) {
        // Release the response we are about to abandon. Until a body is
        // consumed, undici holds its socket out of the connection pool, so a
        // retry storm burns a fresh connection per attempt — exactly when the
        // server can least afford it. Reading returns the socket to the pool;
        // `res.body?.cancel()` frees it too, but by destroying the connection,
        // which is the churn this exists to avoid. Error bodies are small, and
        // a read that fails has already released the socket, so a failure here
        // is not worth propagating over the status we are retrying on.
        await res.text().catch(() => {});

        const retryAfter = res.headers.get("retry-after");
        let delayMs = 0;
        if (retryAfter) {
          const seconds = Number(retryAfter);
          delayMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
        }
        if (delayMs <= 0) {
          delayMs = 250 * attempt;
        }
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Parse response
      const text = await res.text();
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

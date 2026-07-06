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

  /** Execute an authenticated PATCH request with a JSON body. */
  async patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "PATCH",
      headers: this.writeHeaders(options),
      body: JSON.stringify(body),
    });
  }

  /** Execute an authenticated DELETE request. */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>(this.buildUrl(path), { method: "DELETE" });
  }

  private writeHeaders(options?: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options?.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
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

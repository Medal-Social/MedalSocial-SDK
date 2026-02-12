import { MedalApiError } from "./types/common";

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  userAgent: string;
}

/**
 * Low-level HTTP client used by all resource classes.
 * Handles authentication, retries, timeout, and error parsing.
 */
export class BaseClient {
  readonly config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: "GET" });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(this.buildUrl(path), { method: "DELETE" });
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
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
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

      // Retry on 429 / 5xx
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt < maxAttempts) {
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
        const body = parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
        throw new MedalApiError(
          res.status,
          body?.error?.code ?? "UNKNOWN_ERROR",
          body?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
          body?.error?.details,
        );
      }

      return parsed as T;
    }

    throw new Error("Request failed after retries");
  }
}

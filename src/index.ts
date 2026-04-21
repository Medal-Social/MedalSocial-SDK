export type AuthOptions =
  | { kind: "basic"; clientId: string; clientSecret: string }
  | { kind: "bearer"; token: string };

export interface ClientOptions {
  baseUrl?: string;
  auth: AuthOptions;
  timeoutMs?: number;
  userAgent?: string;
}

export interface LeadItem {
  name: string;
  email: string;
  company?: string;
  source?: string;
  [key: string]: unknown;
}

export interface ContactNoteInput {
  contactId: string;
  note: string;
  [key: string]: unknown;
}

export interface NoteInput {
  name: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface CookieRecord {
  cookie: string;
  duration: string;
  description: string;
}

export interface CookieCategoryConsent {
  allowed: boolean;
  cookieRecords?: CookieRecord[];
}

export interface CookieConsentInput {
  domain: string;
  consentStatus: "granted" | "denied" | "partial" | string;
  consentTimestamp: string; // ISO-8601
  ipAddress?: string;
  userAgent?: string;
  cookiePreferences: {
    necessary?: CookieCategoryConsent;
    analytics?: CookieCategoryConsent;
    marketing?: CookieCategoryConsent;
    functional?: CookieCategoryConsent;
    [key: string]: CookieCategoryConsent | undefined;
  };
}

export interface EventSignupInput {
  contact: {
    name: string;
    email: string;
    company?: string;
  };
  event: {
    externalId: string;
    name: string;
    description?: string;
    time: string; // ISO-8601
    location?: string;
    thumbnail?: string;
  };
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface TransactionalEmailInput {
  to: string;
  slug: string;
  additionalData?: Record<string, unknown>;
}

export class MedalSocialClient {
  private readonly baseUrl: string;
  private readonly auth: AuthOptions;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.medalsocial.com").replace(/\/$/, "");
    this.auth = options.auth;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.userAgent =
      options.userAgent ??
      "medal-social-sdk/0.1.0 (+https://github.com/Medal-Social/MedalSocial.git)";
  }

  // Public endpoints
  /** Create one or more leads */
  async createLead<T = unknown>(items: LeadItem[]): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/leads", items);
  }

  /** Create a note attached to a contact by id */
  async createContactNote<T = unknown>(input: ContactNoteInput): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/contacts/notes", input);
  }

  /** Record a user’s cookie consent preferences */
  async createCookieConsent<T = unknown>(input: CookieConsentInput): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/cookie-consent", input);
  }

  /** Create an event signup with contact and event details */
  async createEventSignup<T = unknown>(input: EventSignupInput): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/event-signup", input);
  }

  /** Create a free-form note for inbound messages */
  async createNote<T = unknown>(input: NoteInput): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/notes", input);
  }

  /** Send a transactional email by template slug */
  async sendTransactionalEmail<T = unknown>(
    input: TransactionalEmailInput,
  ): Promise<ApiResponse<T>> {
    return this.post<T>("/v1/send-transactional-email", input);
  }

  // Internal HTTP helpers
  private async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      const res = await this.fetchWithAuth(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      // Retry on 429/5xx with basic backoff and Retry-After support
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt < maxAttempts) {
          const retryAfter = res.headers.get("retry-after");
          let delayMs = 0;
          if (retryAfter) {
            const seconds = Number(retryAfter);
            delayMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
          }
          if (delayMs <= 0) {
            delayMs = 250 * attempt; // linear backoff
          }
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
      }

      return this.handleResponse<T>(res);
    }

    throw new Error("Request failed after retries");
  }

  private async fetchWithAuth(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    try {
      headers.set("user-agent", this.userAgent);
    } catch {
      // Some environments (e.g., browsers) disallow setting user-agent; ignore.
    }

    if (this.auth.kind === "bearer") {
      headers.set("authorization", `Bearer ${this.auth.token}`);
    } else if (this.auth.kind === "basic") {
      // Medal Social API expects explicit headers for client credentials
      headers.set("Client-Id", this.auth.clientId);
      headers.set("Client-Secret", this.auth.clientSecret);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleResponse<T>(res: Response): Promise<ApiResponse<T>> {
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text as unknown;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });

    if (!res.ok) {
      const error = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & {
        status?: number;
        details?: unknown;
      };
      error.status = res.status;
      error.details = parsed;
      throw error;
    }

    return { status: res.status, data: parsed as T, headers };
  }
}

/** Convenience factory for Pilot/agent integration — instantiates client from a bearer token. */
export function createMedalClient(apiKey: string, options?: Omit<ClientOptions, 'auth'>): MedalSocialClient {
  return new MedalSocialClient({ ...options, auth: { kind: 'bearer', token: apiKey } });
}

export default MedalSocialClient;

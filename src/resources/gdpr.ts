import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  ConsentRecord,
  ConsentResult,
  CookieConsentInput,
  GdprExport,
  RecordConsentInput,
} from "../types/gdpr";

/** Manage GDPR compliance — data exports, consent records, and cookie consent. */
export class Gdpr {
  constructor(private client: BaseClient) {}

  /**
   * Request a workspace data export. Runs asynchronously.
   *
   * Automatically idempotent: the request is recorded and the export is
   * scheduled in one step with no de-duplication of its own, so an unkeyed
   * retry files a second subject-access request and runs a second full export
   * of the workspace. Supply `options.idempotencyKey` to deduplicate across
   * your OWN retries too.
   */
  async requestExport(
    options?: RequestOptions,
  ): Promise<ApiResponse<{ request_id: string; status: string }>> {
    return this.client.postOnce("/api/v1/gdpr/export", undefined, options);
  }

  /** List all workspace export requests. */
  async listExports(): Promise<ApiResponse<GdprExport[]>> {
    return this.client.get("/api/v1/gdpr/exports");
  }

  /** Get the status of a specific export. */
  async getExport(id: string): Promise<ApiResponse<GdprExport>> {
    return this.client.get(`/api/v1/gdpr/exports/${encodeURIComponent(id)}`);
  }

  /**
   * Record a GDPR consent decision for a contact by email.
   *
   * Deliberately unkeyed: a decision is stored once per
   * (workspace, email, consent type) and overwritten in place, so re-sending
   * the same body reaches the same state and returns the same record id.
   */
  async recordConsent(input: RecordConsentInput): Promise<ApiResponse<ConsentResult>> {
    return this.client.post("/api/v1/gdpr/consent", input);
  }

  /** Get all consent records for a contact by email. */
  async getConsent(email: string): Promise<ApiResponse<ConsentRecord[]>> {
    return this.client.get(`/api/v1/gdpr/consent/${encodeURIComponent(email)}`);
  }

  /**
   * Record cookie consent from an external site (legacy endpoint).
   *
   * Deliberately unkeyed: this legacy route predates the versioned API and
   * does not run the `Idempotency-Key` machinery, so a key here would be a
   * header that changes nothing while implying a guarantee the endpoint cannot
   * make. Treat a failed call as "unknown" and re-send only if a missing
   * consent log matters more to you than a duplicate one.
   */
  async cookieConsent(input: CookieConsentInput): Promise<{ success: boolean; logId?: string }> {
    return this.client.post("/api/cookie-consent", input);
  }
}

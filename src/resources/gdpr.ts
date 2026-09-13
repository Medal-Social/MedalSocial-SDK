import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  ConsentRecord,
  ConsentResult,
  CookieConsentInput,
  CookieConsentResult,
  GdprExport,
  RecordConsentInput,
} from "../types/gdpr";
import { CapabilityConfirmations } from "./capability-confirmations";

/** Manage GDPR compliance — data exports, consent records, and cookie consent. */
export class Gdpr {
  private client: BaseClient;
  private confirmer: CapabilityConfirmer;

  constructor(client: BaseClient, confirmer?: CapabilityConfirmer) {
    this.client = client;
    this.confirmer = confirmer ?? new CapabilityConfirmer(new CapabilityConfirmations(client));
  }

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
    const resolved = await this.confirmer.prepare(
      { capabilityId: "compliance.gdpr.export.execute", body: undefined },
      undefined,
      options,
    );
    return this.client.postOnce("/api/v1/gdpr/export", undefined, resolved);
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
  async recordConsent(
    input: RecordConsentInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConsentResult>> {
    return this.client.post("/api/v1/gdpr/consent", input, options);
  }

  /** Get all consent records for a contact by email. */
  async getConsent(email: string): Promise<ApiResponse<ConsentRecord[]>> {
    return this.client.get(`/api/v1/gdpr/consent/${encodeURIComponent(email)}`);
  }

  /**
   * Record a cookie consent event from an external site, server-to-server.
   *
   * The event is appended to the workspace's hash-chained audit trail — the
   * evidence a regulator would be shown — so `domain` must be one your
   * workspace's registered sites vouch for, or the call is refused with
   * `403`. Every string field is bounded; over-length values are `400`, never
   * truncated. Metered at 600/min per API key, answering `429` with
   * `Retry-After` beyond that.
   *
   * This route takes a **workspace API key**, so call it only from your own
   * backend. Consent collected in the visitor's browser should go to
   * `POST /api/cookie-consent/public` with the site's public
   * `pk_consent_*` key instead — a workspace key must never reach a page.
   *
   * Deliberately unkeyed: this route predates the versioned API and does not
   * run the `Idempotency-Key` machinery, so a key here would be a header that
   * changes nothing while implying a guarantee the endpoint cannot make.
   * Treat a failed call as "unknown" and re-send only if a missing consent log
   * matters more to you than a duplicate one.
   *
   * @example
   * ```ts
   * await medal.gdpr.cookieConsent({
   *   event: 'preferences_saved',
   *   consentId: 'CID-00001234',
   *   domain: 'example.com',
   *   categories: { essential: true, analytics: true, marketing: false },
   * });
   * ```
   */
  async cookieConsent(
    input: CookieConsentInput,
    options?: RequestOptions,
  ): Promise<CookieConsentResult> {
    return this.client.post("/api/cookie-consent", input, options);
  }
}

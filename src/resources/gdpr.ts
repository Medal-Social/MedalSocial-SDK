import type { BaseClient } from "../client";
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

  /** Request a workspace data export. Runs asynchronously. */
  async requestExport(): Promise<ApiResponse<{ request_id: string; status: string }>> {
    return this.client.post("/api/v1/gdpr/export");
  }

  /** List all workspace export requests. */
  async listExports(): Promise<ApiResponse<GdprExport[]>> {
    return this.client.get("/api/v1/gdpr/exports");
  }

  /** Get the status of a specific export. */
  async getExport(id: string): Promise<ApiResponse<GdprExport>> {
    return this.client.get(`/api/v1/gdpr/exports/${encodeURIComponent(id)}`);
  }

  /** Record a GDPR consent decision for a contact by email. */
  async recordConsent(input: RecordConsentInput): Promise<ApiResponse<ConsentResult>> {
    return this.client.post("/api/v1/gdpr/consent", input);
  }

  /** Get all consent records for a contact by email. */
  async getConsent(email: string): Promise<ApiResponse<ConsentRecord[]>> {
    return this.client.get(`/api/v1/gdpr/consent/${encodeURIComponent(email)}`);
  }

  /** Record cookie consent from an external site (legacy endpoint). */
  async cookieConsent(input: CookieConsentInput): Promise<{ success: boolean; logId?: string }> {
    return this.client.post("/api/cookie-consent", input);
  }
}

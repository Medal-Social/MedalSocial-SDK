import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  BatchSendInput,
  BatchSendSummary,
  EmailSend,
  EmailSendResult,
  EmailTemplate,
  EmailTemplateDetail,
  GetTemplateOptions,
  SendEmailInput,
} from "../types/emails";

/** Manage email templates stored in the workspace. */
class EmailTemplates {
  constructor(private client: BaseClient) {}

  /** List all active email templates in the workspace. */
  async list(): Promise<ApiResponse<EmailTemplate[]>> {
    return this.client.get("/api/v1/emails/templates");
  }

  /** Get a specific email template by slug, optionally with locale resolution. */
  async get(slug: string, options?: GetTemplateOptions): Promise<ApiResponse<EmailTemplateDetail>> {
    const params: Record<string, string | undefined> = {};
    if (options?.locale) params.locale = options.locale;
    if (options?.fallback_locale) params.fallback_locale = options.fallback_locale;
    return this.client.get(`/api/v1/emails/templates/${encodeURIComponent(slug)}`, params);
  }
}

/** Send transactional emails and manage templates. */
export class Emails {
  readonly templates: EmailTemplates;

  constructor(private client: BaseClient) {
    this.templates = new EmailTemplates(client);
  }

  /**
   * Send a transactional email using a template (HTTP 202). The returned `id`
   * is an email send id — poll `emails.get(id)` with it to track delivery.
   */
  async send(input: SendEmailInput): Promise<ApiResponse<EmailSendResult>> {
    return this.client.post("/api/v1/emails", input);
  }

  /** Get the delivery status of a sent email. */
  async get(id: string): Promise<ApiResponse<EmailSend>> {
    return this.client.get(`/api/v1/emails/${encodeURIComponent(id)}`);
  }

  /**
   * Send the same template to multiple recipients (max 100, HTTP 202). Each
   * queued recipient gets its own send id in `results` for `emails.get(id)`.
   */
  async batch(input: BatchSendInput): Promise<ApiResponse<BatchSendSummary>> {
    return this.client.post("/api/v1/emails/batch", input);
  }
}

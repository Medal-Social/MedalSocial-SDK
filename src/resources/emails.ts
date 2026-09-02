import type { BaseClient, RequestOptions } from "../client";
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
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay rather than queue a second copy into someone's inbox —
   * a send that already committed cannot be un-sent. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too.
   *
   * `input.idempotency_key` is the older, body-level form of the same control
   * and still takes precedence server-side, so setting it keeps working
   * unchanged.
   */
  async send(
    input: SendEmailInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<EmailSendResult>> {
    return this.client.postOnce("/api/v1/emails", input, options);
  }

  /** Get the delivery status of a sent email. */
  async get(id: string): Promise<ApiResponse<EmailSend>> {
    return this.client.get(`/api/v1/emails/${encodeURIComponent(id)}`);
  }

  /**
   * Send the same template to multiple recipients (max 100, HTTP 202). Each
   * queued recipient gets its own send id in `results` for `emails.get(id)`.
   *
   * Automatically idempotent — and this is the call where it matters most: an
   * unkeyed retry of a batch that already committed sends up to 100 duplicate
   * emails. Supply `options.idempotencyKey` to deduplicate across your OWN
   * retries too.
   */
  async batch(
    input: BatchSendInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BatchSendSummary>> {
    return this.client.postOnce("/api/v1/emails/batch", input, options);
  }
}

import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  BatchSendInput,
  BatchSendResult,
  EmailSend,
  EmailSendResult,
  EmailTemplate,
  SendEmailInput,
} from "../types/emails";

class EmailTemplates {
  constructor(private client: BaseClient) {}

  /** List all active email templates in the workspace. */
  async list(): Promise<ApiResponse<EmailTemplate[]>> {
    return this.client.get("/api/v1/emails/templates");
  }

  /** Get a specific email template by slug. */
  async get(slug: string): Promise<ApiResponse<EmailTemplate>> {
    return this.client.get(`/api/v1/emails/templates/${encodeURIComponent(slug)}`);
  }
}

export class Emails {
  readonly templates: EmailTemplates;

  constructor(private client: BaseClient) {
    this.templates = new EmailTemplates(client);
  }

  /** Send a transactional email using a template. Returns a queued job ID. */
  async send(input: SendEmailInput): Promise<ApiResponse<EmailSendResult>> {
    return this.client.post("/api/v1/emails", input);
  }

  /** Get the delivery status of a sent email. */
  async get(id: string): Promise<ApiResponse<EmailSend>> {
    return this.client.get(`/api/v1/emails/${encodeURIComponent(id)}`);
  }

  /** Send the same template to multiple recipients (max 100). */
  async batch(input: BatchSendInput): Promise<ApiResponse<BatchSendResult[]>> {
    return this.client.post("/api/v1/emails/batch", input);
  }
}

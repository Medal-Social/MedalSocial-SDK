/** Input for sending a transactional email via a template. */
export interface SendEmailInput {
  template_slug: string;
  to: string;
  name?: string;
  locale?: string;
  fallback_locale?: string;
  variables?: Record<string, string>;
  contact_id?: string;
  /** Body-level idempotency key (alternative to the `Idempotency-Key` header). */
  idempotency_key?: string;
  /** Also send a `[Copy]` of the email to this address. */
  copy_to?: string;
  /** Reply-To for the copy (defaults to the primary recipient). */
  copy_reply_to?: string;
}

/** Result returned after queuing a transactional email send (HTTP 202). */
export interface EmailSendResult {
  /** Email send id — poll `emails.get(id)` with it to track delivery. */
  id: string | null;
  /** Send id of the `copy_to` copy, or `null` when no copy was requested. */
  copy_id: string | null;
  /** CRM contact linked to the send, or `null`. */
  contact_id: string | null;
  status: string;
}

/** Full record for a sent email, including delivery timestamps. */
export interface EmailSend {
  id: string;
  status: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string | null;
  template_id: string | null;
  contact_id: string | null;
  queued_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  error_message: string | null;
}

/** Input for sending the same template to multiple recipients (max 100). */
export interface BatchSendInput {
  template_slug: string;
  default_locale?: string;
  recipients: {
    email: string;
    name?: string;
    locale?: string;
    variables?: Record<string, string>;
  }[];
}

/** Per-recipient outcome of a batch send, in request order. */
export interface BatchSendRecipientResult {
  email: string;
  /** Email send id — poll `emails.get(id)` with it. `null` when not queued. */
  id: string | null;
  status: "queued" | "failed";
  /** Failure reason for recipients that were not queued. */
  error: string | null;
}

/** Summary returned after queuing a batch email send. */
export interface BatchSendSummary {
  batch_id: string;
  total: number;
  queued: number;
  failed: number;
  /** Per-recipient outcome, in request order. */
  results: BatchSendRecipientResult[];
}

/** @deprecated Use `BatchSendSummary` for `emails.batch()` responses. */
export type BatchSendResult = BatchSendSummary;

/** An email template stored in the workspace. */
export interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  type: string | null;
  subject: string | null;
  default_locale: string;
  available_locales: string[];
  description: string | null;
  category: string | null;
  label_ids: string[];
  is_active: boolean;
  is_archived: boolean;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}

/** Full template detail including per-locale content. */
export interface EmailTemplateDetail extends EmailTemplate {
  html_content: string | null;
  text_content: string | null;
  preview_text: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  requested_locale: string | null;
  resolved_locale: string;
  content_source: string;
  localizations: {
    locale: string | null;
    subject: string | null;
    html_content: string | null;
    text_content: string | null;
    preview_text: string | null;
  }[];
}

/** Options for fetching a template with locale resolution. */
export interface GetTemplateOptions {
  locale?: string;
  fallback_locale?: string;
}

export interface SendEmailInput {
  template_slug: string;
  to: string;
  name?: string;
  locale?: string;
  fallback_locale?: string;
  variables?: Record<string, string>;
  contact_id?: string;
}

export interface EmailSendResult {
  id: string;
  status: string;
}

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

export interface BatchSendSummary {
  batch_id: string;
  total: number;
  queued: number;
  failed: number;
}

/** @deprecated Use `BatchSendSummary` for `emails.batch()` responses. */
export type BatchSendResult = BatchSendSummary;

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

export interface GetTemplateOptions {
  locale?: string;
  fallback_locale?: string;
}

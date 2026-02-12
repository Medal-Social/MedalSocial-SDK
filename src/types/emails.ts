export interface SendEmailInput {
  template_slug: string;
  to: string;
  name?: string;
  variables?: Record<string, string>;
}

export interface EmailSendResult {
  id: string;
  status: string;
}

export interface EmailSend {
  id: string;
  to: string;
  subject: string | null;
  status: string;
  template_slug: string | null;
  sent_at: number | null;
  delivered_at: number | null;
  opened_at: number | null;
  clicked_at: number | null;
  bounced_at: number | null;
  created_at: number;
}

export interface BatchSendInput {
  template_slug: string;
  recipients: {
    email: string;
    name?: string;
    variables?: Record<string, string>;
  }[];
}

export interface BatchSendResult {
  email: string;
  id: string;
  status: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string | null;
  variables: string[] | null;
  created_at: number;
}

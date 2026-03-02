import type { PaginationOptions } from "./common";

export interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  address: Record<string, string> | null;
  status: ContactStatus;
  email_status: EmailStatus;
  label_ids: string[];
  source: string | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContactCreateResult {
  id: string;
}

export interface ContactUpdateResult {
  success: true;
}

export interface ContactRemoveResult {
  success: true;
}

export interface ContactNoteResult {
  id: string;
}

export type ContactStatus = "lead" | "prospect" | "customer" | "churned" | "archived";
export type EmailStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";

export interface CreateContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  job_title?: string;
  address?: Record<string, string>;
  status?: ContactStatus;
  email_status?: EmailStatus;
  label_ids?: string[];
  /** Label names — auto-created if they don't exist in the workspace. */
  labels?: string[];
  custom_fields?: Record<string, unknown>;
  notes?:
    | string
    | {
        content: string;
        attachments?: { url: string; name: string; type?: string; size?: number }[];
      };
}

export interface UpdateContactInput {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  job_title?: string;
  status?: ContactStatus;
  email_status?: EmailStatus;
  label_ids?: string[];
  /** Label names — auto-created if they don't exist in the workspace. */
  labels?: string[];
  custom_fields?: Record<string, unknown>;
}

export interface ListContactsOptions extends PaginationOptions {
  status?: ContactStatus;
  email_status?: EmailStatus;
  label_ids?: string[];
  search?: string;
}

export interface ImportContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  job_title?: string;
  label_ids?: string[];
  status?: string;
}

export interface ImportContactsResult {
  added: number;
  skipped: number;
  total: number;
}

export interface Activity {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  actor_name: string | null;
  actor_type: string | null;
  metadata: unknown;
  created_at: string | null;
}

export interface AddNoteInput {
  content: string;
}

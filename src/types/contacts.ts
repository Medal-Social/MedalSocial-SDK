import type { PaginationOptions } from "./common";

/** A contact in the workspace CRM. */
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

/** Result returned after creating a contact. */
export interface ContactCreateResult {
  id: string;
}

/** Result returned after updating a contact. */
export interface ContactUpdateResult {
  success: true;
}

/** Result returned after deleting a contact. */
export interface ContactRemoveResult {
  success: true;
}

/** Result returned after adding a note to a contact. */
export interface ContactNoteResult {
  id: string;
}

/** Lifecycle stage of a contact in the CRM. */
export type ContactStatus = "lead" | "prospect" | "customer" | "churned" | "archived";

/** Email deliverability status for a contact. */
export type EmailStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";

/** Input for creating a new contact. */
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

/** Input for updating one or more fields on a contact. */
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

/** Options for listing contacts with pagination and filters. */
export interface ListContactsOptions extends PaginationOptions {
  status?: ContactStatus;
  email_status?: EmailStatus;
  label_ids?: string[];
  search?: string;
}

/** A single contact record for bulk import. */
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

/** Summary returned after a bulk contact import. */
export interface ImportContactsResult {
  added: number;
  skipped: number;
  total: number;
}

/** A contact activity event on the timeline. */
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

/** Input for adding a text note to a contact's timeline. */
export interface AddNoteInput {
  content: string;
}

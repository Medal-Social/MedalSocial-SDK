import type { PaginationOptions } from "./common";

/**
 * A contact's postal address.
 *
 * The keys are camelCase (`postalCode`) — the one object in `/api/v1` that is
 * not snake_case. It is stored and returned as-is, and the API rejects any
 * key outside these five with a `400 VALIDATION_ERROR`.
 */
export interface ContactAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** A contact in the workspace CRM. */
export interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  address: ContactAddress | null;
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

/**
 * Lifecycle stage of a contact in the CRM — the only four values a contact
 * can hold. Any other value is a `400 VALIDATION_ERROR` on create, update,
 * import and the list filter alike.
 */
export type ContactStatus = "lead" | "subscriber" | "customer" | "churned";

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
  address?: ContactAddress;
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
  /** Free-text search across name, email and company. */
  search?: string;
  /**
   * Exact-match on the contact's email address. This is the lookup for "the
   * contact for this e-mail" — `search` is a fuzzy match that can return more
   * than one row.
   */
  email?: string;
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
  status?: ContactStatus;
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
  /**
   * Type-specific details (an email subject, a clicked link, …), or `null`.
   * Deliberately `unknown`: the server stores this column as free-form JSON
   * and returns it untouched, so its shape depends on `type`. Narrow it
   * yourself before reading into it.
   */
  metadata: unknown;
  created_at: string | null;
}

/** Input for adding a text note to a contact's timeline. */
export interface AddNoteInput {
  content: string;
}

import type { PaginationOptions } from "./common";

export interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  status: ContactStatus;
  email_status: EmailStatus;
  source: string | null;
  tags: string[] | null;
  created_at: number;
  updated_at: number | null;
}

export type ContactStatus = "lead" | "prospect" | "customer" | "churned" | "archived";
export type EmailStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";

export interface CreateContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  status?: ContactStatus;
  tags?: string[];
}

export interface UpdateContactInput {
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  status?: ContactStatus;
  tags?: string[];
}

export interface ListContactsOptions extends PaginationOptions {
  status?: ContactStatus;
  email_status?: EmailStatus;
  tags?: string[];
  search?: string;
}

export interface ImportContactsResult {
  imported: number;
  skipped: number;
  total: number;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  note_content: string | null;
  actor_type: "user" | "system" | "contact";
  actor_name: string | null;
  timestamp: number;
  metadata: unknown;
}

export interface AddNoteInput {
  content: string;
}

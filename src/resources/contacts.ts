import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse, PaginatedResponse, PaginationOptions } from "../types/common";
import type {
  Activity,
  AddNoteInput,
  Contact,
  ContactCreateResult,
  ContactNoteResult,
  ContactRemoveResult,
  ContactUpdateResult,
  CreateContactInput,
  ImportContactInput,
  ImportContactsResult,
  ListContactsOptions,
  UpdateContactInput,
} from "../types/contacts";

/** Manage contacts in the workspace CRM. */
export class Contacts {
  constructor(private client: BaseClient) {}

  /** List contacts with cursor-based pagination and optional filters. */
  async list(options?: ListContactsOptions): Promise<PaginatedResponse<Contact>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.email_status) params.email_status = options.email_status;
    if (options?.label_ids) params.label_ids = options.label_ids.join(",");
    if (options?.search) params.search = options.search;
    return this.client.get("/api/v1/contacts", params);
  }

  /**
   * Create a new contact. Email must be unique in the workspace.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay rather than run the create a second time. Uniqueness
   * alone would not save you here — it turns the retry of a committed create
   * into a spurious conflict, which reads as "the contact was not created".
   * Supply `options.idempotencyKey` to deduplicate across your OWN retries too.
   */
  async create(
    input: CreateContactInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactCreateResult>> {
    return this.client.postOnce("/api/v1/contacts", input, options);
  }

  /** Get a contact by ID. */
  async get(id: string): Promise<ApiResponse<Contact>> {
    return this.client.get(`/api/v1/contacts/${encodeURIComponent(id)}`);
  }

  /** Update one or more fields on a contact. */
  async update(id: string, input: UpdateContactInput): Promise<ApiResponse<ContactUpdateResult>> {
    return this.client.patch(`/api/v1/contacts/${encodeURIComponent(id)}`, input);
  }

  /** Permanently delete a contact. */
  async remove(id: string): Promise<ApiResponse<ContactRemoveResult>> {
    return this.client.delete(`/api/v1/contacts/${encodeURIComponent(id)}`);
  }

  /** Get the activity timeline for a contact. */
  async activities(id: string, options?: PaginationOptions): Promise<PaginatedResponse<Activity>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.client.get(`/api/v1/contacts/${encodeURIComponent(id)}/activities`, params);
  }

  /**
   * Add a note to a contact's timeline.
   *
   * Automatically idempotent: nothing about a note is unique, so an unkeyed
   * retry appends the same text to the timeline twice. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too.
   */
  async addNote(
    id: string,
    input: AddNoteInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactNoteResult>> {
    return this.client.postOnce(`/api/v1/contacts/${encodeURIComponent(id)}/notes`, input, options);
  }

  /**
   * Bulk import contacts (max 500). Duplicates are skipped.
   *
   * Automatically idempotent: the import is processed in chunks, so a retry
   * after a partial failure re-walks the whole batch and reports `added` /
   * `skipped` counts for a run that was not the first. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too.
   */
  async import(
    contacts: ImportContactInput[],
    options?: RequestOptions,
  ): Promise<ApiResponse<ImportContactsResult>> {
    return this.client.postOnce("/api/v1/contacts/import", { contacts }, options);
  }
}

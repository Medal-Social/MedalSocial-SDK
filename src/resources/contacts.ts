import type { BaseClient } from "../client";
import type { ApiResponse, PaginatedResponse, PaginationOptions } from "../types/common";
import type {
  Activity,
  AddNoteInput,
  Contact,
  CreateContactInput,
  ImportContactsResult,
  ListContactsOptions,
  UpdateContactInput,
} from "../types/contacts";

export class Contacts {
  constructor(private client: BaseClient) {}

  /** List contacts with cursor-based pagination and optional filters. */
  async list(options?: ListContactsOptions): Promise<PaginatedResponse<Contact>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.email_status) params.email_status = options.email_status;
    if (options?.tags) params.tags = options.tags.join(",");
    if (options?.search) params.search = options.search;
    return this.client.get("/api/v1/contacts", params);
  }

  /** Create a new contact. Email must be unique in the workspace. */
  async create(input: CreateContactInput): Promise<ApiResponse<Contact>> {
    return this.client.post("/api/v1/contacts", input);
  }

  /** Get a contact by ID. */
  async get(id: string): Promise<ApiResponse<Contact>> {
    return this.client.get(`/api/v1/contacts/${encodeURIComponent(id)}`);
  }

  /** Update one or more fields on a contact. */
  async update(id: string, input: UpdateContactInput): Promise<ApiResponse<Contact>> {
    return this.client.patch(`/api/v1/contacts/${encodeURIComponent(id)}`, input);
  }

  /** Permanently delete a contact. */
  async remove(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.delete(`/api/v1/contacts/${encodeURIComponent(id)}`);
  }

  /** Get the activity timeline for a contact. */
  async activities(
    id: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponse<Activity>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.client.get(`/api/v1/contacts/${encodeURIComponent(id)}/activities`, params);
  }

  /** Add a note to a contact's timeline. */
  async addNote(
    id: string,
    input: AddNoteInput,
  ): Promise<ApiResponse<{ activity_id: string }>> {
    return this.client.post(`/api/v1/contacts/${encodeURIComponent(id)}/notes`, input);
  }

  /** Bulk import contacts (max 500). Duplicates are skipped. */
  async import(contacts: CreateContactInput[]): Promise<ApiResponse<ImportContactsResult>> {
    return this.client.post("/api/v1/contacts/import", { contacts });
  }
}

import type { BaseClient } from "../client";
import type { ApiResponse, PaginatedResponse } from "../types/common";
import type {
  CreateDealInput,
  Deal,
  ListDealsOptions,
  UpdateDealInput,
} from "../types/deals";

export class Deals {
  constructor(private client: BaseClient) {}

  /** List deals with cursor-based pagination and optional filters. */
  async list(options?: ListDealsOptions): Promise<PaginatedResponse<Deal>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.contact_id) params.contact_id = options.contact_id;
    return this.client.get("/api/v1/deals", params);
  }

  /** Create a new deal. */
  async create(input: CreateDealInput): Promise<ApiResponse<Deal>> {
    return this.client.post("/api/v1/deals", input);
  }

  /** Get a deal by ID. */
  async get(id: string): Promise<ApiResponse<Deal>> {
    return this.client.get(`/api/v1/deals/${encodeURIComponent(id)}`);
  }

  /** Update one or more fields on a deal. */
  async update(id: string, input: UpdateDealInput): Promise<ApiResponse<Deal>> {
    return this.client.patch(`/api/v1/deals/${encodeURIComponent(id)}`, input);
  }

  /** Permanently delete a deal. */
  async remove(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.delete(`/api/v1/deals/${encodeURIComponent(id)}`);
  }
}

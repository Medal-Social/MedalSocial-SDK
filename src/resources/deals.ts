import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse, PaginatedResponse } from "../types/common";
import type {
  CreateDealInput,
  Deal,
  DealCreateResult,
  DealRemoveResult,
  DealUpdateResult,
  ListDealsOptions,
  UpdateDealInput,
} from "../types/deals";

/** Manage sponsorship deals in the workspace. */
export class Deals {
  constructor(private client: BaseClient) {}

  /** List deals with cursor-based pagination and optional filters. */
  async list(options?: ListDealsOptions): Promise<PaginatedResponse<Deal>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.search) params.search = options.search;
    return this.client.get("/api/v1/deals", params);
  }

  /**
   * Create a new deal.
   *
   * Automatically idempotent: nothing about a deal is unique, so an unkeyed
   * retry puts a second identical deal in the pipeline. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too.
   */
  async create(
    input: CreateDealInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<DealCreateResult>> {
    return this.client.postOnce("/api/v1/deals", input, options);
  }

  /** Get a deal by ID. */
  async get(id: string): Promise<ApiResponse<Deal>> {
    return this.client.get(`/api/v1/deals/${encodeURIComponent(id)}`);
  }

  /** Update one or more fields on a deal. Set contact_id to null to unlink. */
  async update(id: string, input: UpdateDealInput): Promise<ApiResponse<DealUpdateResult>> {
    return this.client.patch(`/api/v1/deals/${encodeURIComponent(id)}`, input);
  }

  /** Permanently delete a deal. */
  async remove(id: string): Promise<ApiResponse<DealRemoveResult>> {
    return this.client.delete(`/api/v1/deals/${encodeURIComponent(id)}`);
  }
}

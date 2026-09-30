import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import { paginate } from "../client";
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
import { CapabilityConfirmations } from "./capability-confirmations";

/** Manage sponsorship deals in the workspace. */
export class Deals {
  private client: BaseClient;
  private confirmer: CapabilityConfirmer;

  constructor(client: BaseClient, confirmer?: CapabilityConfirmer) {
    this.client = client;
    this.confirmer = confirmer ?? new CapabilityConfirmer(new CapabilityConfirmations(client));
  }

  /** List deals with cursor-based pagination and optional filters. */
  async list(options?: ListDealsOptions): Promise<PaginatedResponse<Deal>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.search) params.search = options.search;
    if (options?.close_date_from !== undefined) {
      params.close_date_from = String(options.close_date_from);
    }
    if (options?.close_date_to !== undefined) {
      params.close_date_to = String(options.close_date_to);
    }
    if (options?.min_value !== undefined) params.min_value = String(options.min_value);
    if (options?.company_name) params.company_name = options.company_name;
    if (options?.contact_id) params.contact_id = options.contact_id;
    if (options?.stage) params.stage = options.stage;
    return this.client.get("/api/v1/deals", params);
  }

  /**
   * Every deal the filters match, page after page.
   *
   * ```ts
   * for await (const deal of medal.deals.iter({ status: "negotiating" })) …
   * ```
   *
   * Drives the cursor itself off `pagination.has_more`; pages are fetched
   * lazily, so `break` stops the walk without requesting the next one.
   */
  iter(options?: ListDealsOptions): AsyncGenerator<Deal, void, undefined> {
    return paginate((cursor) => this.list({ ...options, ...(cursor ? { cursor } : {}) }));
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
    const resolved = await this.confirmer.prepare(
      { capabilityId: "deals.deal.create.execute", body: input },
      undefined,
      options,
    );
    return this.client.postOnce("/api/v1/deals", input, resolved);
  }

  /** Get a deal by ID. */
  async get(id: string): Promise<ApiResponse<Deal>> {
    return this.client.get(`/api/v1/deals/${encodeURIComponent(id)}`);
  }

  /** Update one or more fields on a deal. Set contact_id to null to unlink. */
  async update(
    id: string,
    input: UpdateDealInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<DealUpdateResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "deals.deal.update.execute", body: input },
      { id },
      options,
    );
    return this.client.patch(`/api/v1/deals/${encodeURIComponent(id)}`, input, resolved);
  }

  /** Permanently delete a deal. */
  async remove(id: string, options?: RequestOptions): Promise<ApiResponse<DealRemoveResult>> {
    return this.client.delete(`/api/v1/deals/${encodeURIComponent(id)}`, options);
  }

  /** `delete` reads better at some call sites; identical to {@link remove}. */
  async delete(id: string, options?: RequestOptions): Promise<ApiResponse<DealRemoveResult>> {
    return this.remove(id, options);
  }
}

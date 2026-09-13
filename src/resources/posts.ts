import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import { paginate } from "../client";
import type { ApiResponse, PaginatedResponse } from "../types/common";
import type {
  Channel,
  CreatePostInput,
  ListPostsOptions,
  Post,
  PostDetail,
  PublishResult,
  SchedulePostInput,
  ScheduleResult,
  UpdatePostInput,
} from "../types/posts";
import { CapabilityConfirmations } from "./capability-confirmations";

/** Create and publish posts across connected channels. */
export class Posts {
  private client: BaseClient;
  private confirmer: CapabilityConfirmer;

  constructor(client: BaseClient, confirmer?: CapabilityConfirmer) {
    this.client = client;
    this.confirmer = confirmer ?? new CapabilityConfirmer(new CapabilityConfirmations(client));
  }

  /** List posts with cursor-based pagination and optional filters. */
  async list(options?: ListPostsOptions): Promise<PaginatedResponse<Post>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.type) params.type = options.type;
    if (options?.scheduled_from !== undefined) {
      params.scheduled_from = String(options.scheduled_from);
    }
    if (options?.scheduled_to !== undefined) params.scheduled_to = String(options.scheduled_to);
    if (options?.published_from !== undefined) {
      params.published_from = String(options.published_from);
    }
    if (options?.published_to !== undefined) params.published_to = String(options.published_to);
    if (options?.platforms) params.platforms = options.platforms.join(",");
    if (options?.query) params.query = options.query;
    return this.client.get("/api/v1/posts", params);
  }

  /**
   * Every post the filters match, page after page.
   *
   * ```ts
   * for await (const post of medal.posts.iter({ status: "published" })) …
   * ```
   *
   * Drives the cursor itself off `pagination.has_more`; pages are fetched
   * lazily, so `break` stops the walk without requesting the next one.
   */
  iter(options?: ListPostsOptions): AsyncGenerator<Post, void, undefined> {
    return paginate((cursor) => this.list({ ...options, ...(cursor ? { cursor } : {}) }));
  }

  /**
   * Create a new post with content and target channels.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay rather than draft the post twice. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too.
   */
  async create(
    input: CreatePostInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ id: string }>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "content.post.draft.create", body: input },
      undefined,
      options,
    );
    return this.client.postOnce("/api/v1/posts", input, resolved);
  }

  /** Get a post by ID, including its per-channel variants. */
  async get(id: string): Promise<ApiResponse<PostDetail>> {
    return this.client.get(`/api/v1/posts/${encodeURIComponent(id)}`);
  }

  /** Update a draft post's title or content. */
  async update(
    id: string,
    input: UpdatePostInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.patch(`/api/v1/posts/${encodeURIComponent(id)}`, input, options);
  }

  /** Delete a post. */
  async remove(id: string, options?: RequestOptions): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.delete(`/api/v1/posts/${encodeURIComponent(id)}`, options);
  }

  /** `delete` reads better at some call sites; identical to {@link remove}. */
  async delete(id: string, options?: RequestOptions): Promise<ApiResponse<{ success: boolean }>> {
    return this.remove(id, options);
  }

  /**
   * Schedule a post for future publication.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so a 5xx
   * retry of a schedule that already committed REPLAYS the stored response —
   * the original `workflow_id` and status — instead of meeting the server's
   * "already scheduled" refusal and reporting a success as an error.
   * Re-sending a *different* `scheduled_at` is still rejected; unschedule
   * first.
   */
  async schedule(
    id: string,
    input: SchedulePostInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ScheduleResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "content.post.schedule.execute", body: input },
      { id },
      options,
    );
    return this.client.postOnce(
      `/api/v1/posts/${encodeURIComponent(id)}/schedule`,
      input,
      resolved,
    );
  }

  /**
   * Publish a post immediately to all target channels.
   *
   * Automatically idempotent: without a key, the retry of a publish that had
   * already committed met the status guard and answered `400` — a success
   * reported as a failure, which is the worst of the three outcomes. With the
   * key the server replays the original `200` and its `workflow_id`, so a lost
   * response costs nothing and the post is published exactly once.
   */
  async publish(id: string, options?: RequestOptions): Promise<ApiResponse<PublishResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "content.post.publish.execute", body: undefined },
      { id },
      options,
    );
    return this.client.postOnce(
      `/api/v1/posts/${encodeURIComponent(id)}/publish`,
      undefined,
      resolved,
    );
  }

  /** List connected publishing channels for this workspace. */
  async channels(): Promise<ApiResponse<Channel[]>> {
    return this.client.get("/api/v1/posts/channels");
  }
}

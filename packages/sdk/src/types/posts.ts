import type { PaginationOptions, TimestampInput } from "./common";

/**
 * Lifecycle status of a post — the only values the post row can hold.
 *
 * `partial` means some variants published and some failed; `unpublished`
 * means every published variant was taken down again.
 */
export type PostStatus =
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "partial"
  | "unpublished";

/** Publishing state of a single per-channel variant. */
export type PostVariantStatus =
  | "pending"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "unpublishing"
  | "unpublished";

/** A post in the workspace (list view). */
export interface Post {
  id: string;
  type: PostType;
  title: string | null;
  content: string;
  status: PostStatus;
  channel_ids: string[];
  variant_count: number;
  published_count: number;
  failed_count: number;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Content format / distribution channel type for a post. */
export type PostType = "social" | "newsletter" | "blog";

/** Per-channel variant of a post with publishing state. */
export interface PostVariant {
  id: string;
  channel_id: string;
  content: string;
  status: PostVariantStatus;
  platform: string | null;
  channel_display_name: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  platform_post_id: string | null;
  permalink: string | null;
  error: string | null;
}

/** Full post detail including per-channel variants. */
export interface PostDetail extends Post {
  variants: PostVariant[];
}

/** A connected publishing channel in the workspace. */
export interface Channel {
  id: string;
  platform: string | null;
  display_name: string | null;
  platform_username: string | null;
  state: string;
  connected_at: string | null;
}

/** Input for creating a new post. */
export interface CreatePostInput {
  type?: PostType;
  title?: string;
  content: string;
  channel_ids: string[];
}

/** Input for updating a draft post's title or content. */
export interface UpdatePostInput {
  title?: string;
  content?: string;
}

/** Input for scheduling a post for future publication. */
export interface SchedulePostInput {
  /** Unix timestamp (ms) or ISO datetime string. */
  scheduled_at: number | string;
}

/** Options for listing posts with pagination and filters. */
export interface ListPostsOptions extends PaginationOptions {
  status?: PostStatus;
  type?: PostType;
  /** Inclusive lower bound on `scheduled_at`. */
  scheduled_from?: TimestampInput;
  /** Inclusive upper bound on `scheduled_at`. */
  scheduled_to?: TimestampInput;
  /** Inclusive lower bound on `published_at`. */
  published_from?: TimestampInput;
  /** Inclusive upper bound on `published_at`. */
  published_to?: TimestampInput;
  /** Only posts targeting at least one of these platforms (serialised as CSV, e.g. `linkedin,x`). */
  platforms?: string[];
  /** Free-text search across title and content. */
  query?: string;
}

/** Result returned after scheduling a post. */
export interface ScheduleResult {
  success: boolean;
  workflow_id: string;
}

/** Result returned after publishing a post immediately. */
export interface PublishResult {
  success: boolean;
  workflow_id: string;
}

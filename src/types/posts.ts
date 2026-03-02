import type { PaginationOptions } from "./common";

export interface Post {
  id: string;
  type: PostType;
  title: string | null;
  content: string;
  status: string;
  channel_ids: string[];
  variant_count: number;
  published_count: number;
  failed_count: number;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type PostType = "social" | "newsletter" | "blog";

export interface PostVariant {
  id: string;
  channel_id: string;
  content: string;
  status: string;
  platform: string | null;
  channel_display_name: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  platform_post_id: string | null;
  permalink: string | null;
  error: string | null;
}

export interface PostDetail extends Post {
  variants: PostVariant[];
}

export interface Channel {
  id: string;
  platform: string | null;
  display_name: string | null;
  platform_username: string | null;
  state: string;
  connected_at: string | null;
}

export interface CreatePostInput {
  type?: PostType;
  title?: string;
  content: string;
  channel_ids: string[];
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
}

export interface SchedulePostInput {
  /** Unix timestamp (ms) or ISO datetime string. */
  scheduled_at: number | string;
}

export interface ListPostsOptions extends PaginationOptions {
  status?: string;
  type?: PostType;
}

export interface ScheduleResult {
  success: boolean;
  workflow_id: string;
}

export interface PublishResult {
  success: boolean;
  workflow_id: string;
}

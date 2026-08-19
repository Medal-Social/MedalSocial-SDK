import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse, PaginatedResponse, PaginationOptions } from "../types/common";
import type {
  Conversation,
  ConversationMessage,
  ConversationUpdateResult,
  CreateReplyInput,
  ListConversationsOptions,
  ReplyCreateResult,
  UpdateConversationInput,
} from "../types/helpdesk";
import { CapabilityConfirmations } from "./capability-confirmations";

/** Browse and manage helpdesk conversations. */
class HelpdeskConversations {
  constructor(
    private client: BaseClient,
    private confirmer: CapabilityConfirmer,
  ) {}

  /** List/search conversations with cursor-based pagination and optional filters. */
  async list(options?: ListConversationsOptions): Promise<PaginatedResponse<Conversation>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.assignee_user_id) params.assignee_user_id = options.assignee_user_id;
    if (options?.requester) params.requester = options.requester;
    if (options?.query) params.query = options.query;
    if (options?.channels) params.channels = options.channels.join(",");
    return this.client.get("/api/v1/helpdesk/conversations", params);
  }

  /** Get a conversation by ID. */
  async get(id: string): Promise<ApiResponse<Conversation>> {
    return this.client.get(`/api/v1/helpdesk/conversations/${encodeURIComponent(id)}`);
  }

  /** Update a conversation's status and/or assignee (pass `assignee_user_id: null` to unassign). */
  async update(
    id: string,
    input: UpdateConversationInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConversationUpdateResult>> {
    const resolved = await this.confirmer.prepare(
      "helpdesk.conversation.update.execute",
      { id },
      options,
      input,
    );
    return this.client.patch(
      `/api/v1/helpdesk/conversations/${encodeURIComponent(id)}`,
      input,
      resolved,
    );
  }

  /** Read a conversation's messages with cursor-based pagination. */
  async messages(
    id: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResponse<ConversationMessage>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.client.get(
      `/api/v1/helpdesk/conversations/${encodeURIComponent(id)}/messages`,
      params,
    );
  }
}

/** Send operator replies (or internal notes) into conversations. */
class HelpdeskReplies {
  constructor(
    private client: BaseClient,
    private confirmer: CapabilityConfirmer,
  ) {}

  /**
   * Send an operator reply or internal note. Returns HTTP 201.
   *
   * Pass an `idempotencyKey` so retried requests do not create duplicate
   * messages — it is REQUIRED for capability-scoped tokens.
   */
  async create(
    input: CreateReplyInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ReplyCreateResult>> {
    const resolved = await this.confirmer.prepare(
      "helpdesk.conversation.reply.execute",
      undefined,
      options,
      input,
    );
    return this.client.post("/api/v1/helpdesk/replies", input, resolved);
  }
}

/** Helpdesk bridge — read conversations, reply, and manage assignment/status. */
export class Helpdesk {
  readonly conversations: HelpdeskConversations;
  readonly replies: HelpdeskReplies;

  constructor(client: BaseClient, confirmer?: CapabilityConfirmer) {
    // Direct consumers (`new Helpdesk(client)`) get a confirmer with no
    // client-level default: auto-confirm stays off unless a call opts in via
    // `{ autoConfirm: { previewSummary } }`.
    const resolved = confirmer ?? new CapabilityConfirmer(new CapabilityConfirmations(client));
    this.conversations = new HelpdeskConversations(client, resolved);
    this.replies = new HelpdeskReplies(client, resolved);
  }
}

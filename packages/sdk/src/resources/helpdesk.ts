import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import { paginate, resolveIdempotencyKey } from "../client";
import type { ApiResponse, PaginatedResponse, PaginationOptions } from "../types/common";
import type {
  Conversation,
  ConversationContactLinkResult,
  ConversationContactUnlinkResult,
  ConversationMessage,
  ConversationUpdateResult,
  CreateReplyInput,
  LinkConversationContactInput,
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
    if (options?.chat_type) params.chat_type = options.chat_type;
    if (options?.assigned !== undefined) params.assigned = String(options.assigned);
    return this.client.get("/api/v1/helpdesk/conversations", params);
  }

  /**
   * Every conversation the filters match, page after page.
   *
   * ```ts
   * for await (const thread of medal.helpdesk.conversations.iter({ status: "open" })) …
   * ```
   *
   * This is the iterator the channel filters make necessary: they are applied
   * WITHIN a page, so a page can hold fewer rows than `limit` — or none — while
   * `has_more` is still true, and a hand-rolled loop that stops on an empty page
   * silently drops the rest of the inbox.
   */
  iter(options?: ListConversationsOptions): AsyncGenerator<Conversation, void, undefined> {
    return paginate((cursor) => this.list({ ...options, ...(cursor ? { cursor } : {}) }));
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
      { capabilityId: "helpdesk.conversation.update.execute", body: input },
      { id },
      options,
    );
    return this.client.patch(
      `/api/v1/helpdesk/conversations/${encodeURIComponent(id)}`,
      input,
      resolved,
    );
  }

  /**
   * Bind this thread's sender to a CRM contact — the partner-driven half of
   * contact linking. Pass exactly one of `contact_id` or `email`; an `email`
   * resolves through the CRM's own find-or-create.
   *
   * The link is stored on the SENDER, not on the conversation, so every later
   * thread from the same external contact inherits it and
   * `conversations_updated` counts the threads it reached. Group threads and
   * channels without a stable sender answer `422 CONVERSATION_NOT_LINKABLE`.
   *
   * Automatically idempotent: linking twice reaches the same state, but the
   * confirmation this route requires for capability-scoped tokens is bound to
   * an idempotency key, so the key the confirmer chose is the key that goes out.
   */
  async linkContact(
    id: string,
    input: LinkConversationContactInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConversationContactLinkResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.conversation.link_contact.execute", body: input },
      { id },
      { ...options, idempotencyKey: resolveIdempotencyKey(options?.idempotencyKey) },
    );
    return this.client.put(
      `/api/v1/helpdesk/conversations/${encodeURIComponent(id)}/contact`,
      input,
      resolved,
    );
  }

  /**
   * Detach the sender from their CRM contact, reversing a mistaken link.
   * Idempotent: a thread that carries no contact answers `unlinked: false`.
   */
  async unlinkContact(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConversationContactUnlinkResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.conversation.unlink_contact.execute", body: undefined },
      { id },
      { ...options, idempotencyKey: resolveIdempotencyKey(options?.idempotencyKey) },
    );
    return this.client.delete(
      `/api/v1/helpdesk/conversations/${encodeURIComponent(id)}/contact`,
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
   * Automatically idempotent: a reply is a message to a real person, and an
   * unkeyed retry sends it to them twice. The key the confirmer chose is the
   * key that goes out — a capability confirmation is bound to its idempotency
   * key, so minting a fresh one here would invalidate the confirmation.
   *
   * Pass `options.idempotencyKey` to deduplicate across your OWN retries too.
   * It is REQUIRED for capability-scoped tokens, which need it paired with a
   * `capabilityConfirmation` — a generated key satisfies the pairing's key
   * half only; the confirmation is still yours to supply (or to let
   * `autoConfirm` mint).
   */
  async create(
    input: CreateReplyInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ReplyCreateResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.conversation.reply.execute", body: input },
      undefined,
      options,
    );
    return this.client.postOnce("/api/v1/helpdesk/replies", input, resolved);
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

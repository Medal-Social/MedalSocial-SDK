import type { PaginationOptions } from "./common";

/** Lifecycle status of a helpdesk conversation. */
export type ConversationStatus = "open" | "snoozed" | "closed";

/** Who authored a helpdesk message. */
export type MessageAuthorType = "visitor" | "operator" | "ai" | "system";

/** Kind of helpdesk message. `note` is operator-internal and never delivered to the customer. */
export type HelpdeskMessageType = "chat" | "email" | "note";

/**
 * Channel a helpdesk conversation lives on — the only values the conversation
 * row can hold. The same set is accepted by the `channels` filters on
 * conversation listing and webhook endpoints.
 */
export type HelpdeskChannel =
  | "widget"
  | "instagram"
  | "messenger"
  | "whatsapp"
  | "twitter"
  | "email"
  | "linkedin_dm"
  | "digipost"
  | "finn"
  | "trustpilot"
  | "telegram";

/**
 * Kind of chat on a personal-account channel (Telegram today): a direct
 * message, a group, or a broadcast channel. `null` on widget / business
 * channels, and on a Telegram thread whose first message has not yet
 * identified the chat.
 */
export type HelpdeskChatType = "private" | "group" | "channel";

/**
 * How a conversation's CRM contact was attached: `identity` (the widget
 * visitor's e-mail), `operator` (a member linked it in the inbox) or
 * `partner` (posted through the REST API).
 */
export type ContactLinkSource = "identity" | "operator" | "partner";

/** A helpdesk conversation across any connected channel (widget, email, social DMs, …). */
export interface Conversation {
  id: string;
  channel: HelpdeskChannel;
  channel_connection_id: string | null;
  status: ConversationStatus;
  subject: string | null;
  assignee_user_id: string | null;
  contact_id: string | null;
  /** How `contact_id` was attached, or `null` when the thread carries no contact. */
  contact_link_source: ContactLinkSource | null;
  /** Unix timestamp in milliseconds when the contact was attached, or `null`. */
  contact_linked_at: number | null;
  visitor_name: string | null;
  visitor_email: string | null;
  external_conversation_id: string | null;
  channel_account_id: string | null;
  /** DM / group / channel on personal-account channels; `null` elsewhere. */
  chat_type: HelpdeskChatType | null;
  /** The external group or channel title; `null` for DMs and business channels. */
  chat_title: string | null;
  message_count: number;
  unread_for_operator: number;
  /** Unix timestamp in milliseconds. */
  last_message_at: number;
  last_message_preview: string | null;
  last_message_author_type: MessageAuthorType | null;
  /** Unix timestamp in milliseconds. */
  created_at: number;
  /** Unix timestamp in milliseconds. */
  updated_at: number;
}

/**
 * Outbound delivery state of a helpdesk message.
 *
 * - `pending` — queued for the channel, not handed off yet.
 * - `sent` — handed to the channel provider, no confirmation yet.
 * - `delivered` — the channel confirmed delivery to the customer.
 * - `failed` — delivery failed; see `delivery_error` on the message.
 */
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "failed";

/** A single message inside a helpdesk conversation. */
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  author_type: MessageAuthorType;
  message_type: HelpdeskMessageType;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  /**
   * Outbound delivery state, or `null` for inbound messages and internal
   * notes — neither is ever sent to a channel, so neither has delivery state.
   *
   * **A `201` from `helpdesk.replies.create` means the reply was ACCEPTED, not
   * delivered.** The channel hand-off happens asynchronously afterwards: poll
   * this field (or subscribe to the `helpdesk.message_delivery_updated`
   * webhook event, which carries the same values) to learn whether the message
   * actually reached the customer.
   */
  delivery_status: MessageDeliveryStatus | null;
  /**
   * Last send error for a `failed` outbound message, or `null` when there is
   * no error to report (including on inbound messages and internal notes).
   */
  delivery_error: string | null;
  /**
   * Unix timestamp in milliseconds when the customer deleted this message on
   * the external channel (Telegram today), otherwise `null`.
   *
   * A deleted message is kept as a TOMBSTONE so the thread still reads in
   * order: its `body` is empty and any attachment has been erased. Mirror the
   * deletion in your own store rather than treating it as a blank message.
   * The push-side signal is the `helpdesk.message_deleted` webhook event.
   */
  externally_deleted_at: number | null;
  /** Unix timestamp in milliseconds. */
  created_at: number;
}

/**
 * Filters for listing/searching helpdesk conversations.
 *
 * With any filter set, a page can hold fewer than `limit` items — even none —
 * while `has_more` is still `true`: the server scans one bounded window per
 * request. Keep following `next_cursor` until `has_more` is `false`.
 */
export interface ListConversationsOptions extends PaginationOptions {
  status?: ConversationStatus;
  /** Only conversations assigned to this user. */
  assignee_user_id?: string;
  /**
   * `false` = only conversations nobody owns yet (the triage question
   * `assignee_user_id` cannot ask); `true` = only owned ones. Omit for both.
   */
  assigned?: boolean;
  /** Match against visitor name/email. */
  requester?: string;
  /** Free-text search query. */
  query?: string;
  /** Only conversations on these channels (serialized as CSV). */
  channels?: HelpdeskChannel[];
  /**
   * Only conversations of this chat kind on personal-account channels.
   * Conversations without a chat type never match, so `chat_type: "private"`
   * excludes every widget and business-channel thread.
   */
  chat_type?: HelpdeskChatType;
}

/** Input for updating a conversation's status and/or assignee. At least one field is required. */
export interface UpdateConversationInput {
  status?: ConversationStatus;
  /** User ID to assign, or `null` to unassign. */
  assignee_user_id?: string | null;
}

/** Result of a conversation update. */
export interface ConversationUpdateResult {
  id: string;
  status: ConversationStatus;
  assignee_user_id: string | null;
}

/** Input for sending an operator reply (or internal note) into a conversation. */
export interface CreateReplyInput {
  conversation_id: string;
  /** Message body (max 20,000 characters). */
  body: string;
  /** `note` = operator-internal note (not delivered to the customer). Default `chat`. */
  message_type?: "chat" | "note";
  /** Agent display name for bridged replies (shown in widget + inbox). */
  author_name?: string;
}

/** Result returned after creating a reply (HTTP 201). */
export interface ReplyCreateResult {
  id: string;
  conversation_id: string;
  status: string;
}

/**
 * Input for binding a conversation's sender to a CRM contact — exactly one of
 * `contact_id` or `email`.
 *
 * `email` resolves through the CRM's own find-or-create, so a partner does not
 * have to pre-create a contact first. Sending both, or neither, is a
 * `400 VALIDATION_ERROR`.
 */
export type LinkConversationContactInput =
  | { contact_id: string; email?: never }
  | { email: string; contact_id?: never };

/** Result of linking a conversation's sender to a CRM contact. */
export interface ConversationContactLinkResult {
  conversation_id: string;
  contact_id: string;
  /** The contact the sender was linked to before, when this replaced a link. */
  previous_contact_id: string | null;
  contact_link_source: "partner";
  /** Unix timestamp in milliseconds. */
  contact_linked_at: number;
  /**
   * How many of this sender's conversations now carry the contact — the link is
   * stored per SENDER, so it reaches their older threads too.
   */
  conversations_updated: number;
}

/**
 * Result of unlinking. Idempotent: unlinking a thread that carries no contact
 * answers `unlinked: false` rather than an error.
 */
export interface ConversationContactUnlinkResult {
  conversation_id: string;
  unlinked: boolean;
  previous_contact_id: string | null;
  conversations_updated: number;
}

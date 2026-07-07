import type { PaginationOptions } from "./common";

/** Lifecycle status of a helpdesk conversation. */
export type ConversationStatus = "open" | "snoozed" | "closed";

/** Who authored a helpdesk message. */
export type MessageAuthorType = "visitor" | "operator" | "ai" | "system";

/** Kind of helpdesk message. `note` is operator-internal and never delivered to the customer. */
export type HelpdeskMessageType = "chat" | "email" | "note";

/** A helpdesk conversation across any connected channel (widget, email, social DMs, …). */
export interface Conversation {
  id: string;
  /** Channel type, e.g. 'widget', 'instagram', 'messenger', 'whatsapp', 'email'. */
  channel: string;
  channel_connection_id: string | null;
  status: ConversationStatus;
  subject: string | null;
  assignee_user_id: string | null;
  contact_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  external_conversation_id: string | null;
  channel_account_id: string | null;
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

/** A single message inside a helpdesk conversation. */
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  author_type: MessageAuthorType;
  message_type: HelpdeskMessageType;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  /** Unix timestamp in milliseconds. */
  created_at: number;
}

/** Filters for listing/searching helpdesk conversations. */
export interface ListConversationsOptions extends PaginationOptions {
  status?: ConversationStatus;
  /** Only conversations assigned to this user. */
  assignee_user_id?: string;
  /** Match against visitor name/email. */
  requester?: string;
  /** Free-text search query. */
  query?: string;
  /** Only conversations on these channels (serialized as CSV). */
  channels?: string[];
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

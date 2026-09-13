import type { PaginationOptions } from "./common";

/**
 * The channel types a hosted connect link can attach.
 *
 * Closed on purpose: the server resolves `channel_type` through its connect
 * ADAPTER registry, which holds exactly these two, so anything else is refused
 * rather than stored. A new adapter is a new SDK release.
 */
export type ChannelType = "telegram_inbox" | "linkedin";

/** Lifecycle status of a hosted connect link. */
export type ConnectLinkStatus = "pending" | "consumed" | "expired" | "revoked";

/** Lifecycle state of a channel connection. */
export type ChannelConnectionState = "connecting" | "active" | "disconnected" | "disabled";

/** Input for minting a hosted connect link. */
export interface CreateConnectLinkInput {
  /** Channel type to connect. */
  channel_type: ChannelType;
  /** Display label shown on the hosted connect page (max 100 characters). */
  label?: string;
  /** URL the hosted page redirects to after a successful connect — must be https. */
  redirect_url?: string;
}

/** Result of minting a connect link (HTTP 201). */
export interface ConnectLinkCreateResult {
  id: string;
  /**
   * The single-use hosted connect URL containing the one-time link token.
   * **Present ONLY in the live create response** — an idempotent replay
   * (retrying with the same `Idempotency-Key`) returns the link WITHOUT `url`.
   * If you lose it, revoke the link and mint a new one; the token can never
   * be retrieved again.
   */
  url?: string;
  channel_type: ChannelType;
  label: string | null;
  status: ConnectLinkStatus;
  /** Unix timestamp in milliseconds when the link expires. */
  expires_at: number;
}

/** A hosted connect link (list view — tokens are never returned). */
export interface ConnectLink {
  id: string;
  channel_type: ChannelType;
  label: string | null;
  status: ConnectLinkStatus;
  /** Stable ref of the connection created by consuming this link, or `null`. */
  consumed_connection_ref: string | null;
  /** Unix timestamp in milliseconds. */
  expires_at: number;
  /** Unix timestamp in milliseconds. */
  created_at: number;
}

/** Filters and cursor pagination for listing connect links. */
export interface ListConnectLinksOptions extends PaginationOptions {
  channel_type?: ChannelType;
  status?: ConnectLinkStatus;
}

/** Result of revoking a connect link. */
export interface ConnectLinkRevokeResult {
  id: string;
  status: "revoked";
}

/** A channel connection attached to the workspace (generic, channel-agnostic shape). */
export interface ChannelConnection {
  id: string;
  channel_type: ChannelType;
  label: string | null;
  state: ChannelConnectionState;
  /** Privacy-preserving identity handle (e.g. a masked phone number). */
  masked_identity: string;
  /** Unix timestamp in milliseconds, or `null` if never active. */
  last_activity_at: number | null;
  /** Linked helpdesk channel connection ID, or `null`. */
  helpdesk_connection_id: string | null;
}

/** Result of disconnecting a channel connection. */
export interface ChannelConnectionDisconnectResult {
  id: string;
  state: "disconnected";
}

import type { BaseClient, RequestOptions } from "../client";
import type {
  ChannelConnection,
  ChannelConnectionDisconnectResult,
  ConnectLink,
  ConnectLinkCreateResult,
  ConnectLinkRevokeResult,
  CreateConnectLinkInput,
  ListConnectLinksOptions,
} from "../types/channels";
import type { ApiResponse } from "../types/common";

/** Mint, list, and revoke hosted connect links. */
class ChannelConnectLinks {
  constructor(private client: BaseClient) {}

  /**
   * Mint a single-use hosted connect link. Returns HTTP 201.
   *
   * **The response's `data.url` contains the one-time link token EXACTLY
   * ONCE.** Send it to the person who should connect their account — an
   * idempotent replay (same `Idempotency-Key`) returns the link WITHOUT
   * `url`, so store it immediately (or revoke and mint a new link if lost).
   *
   * Requires the `channel.connect.manage` scope; OAuth callers additionally
   * need the workspace `admin` role.
   */
  async create(
    input: CreateConnectLinkInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConnectLinkCreateResult>> {
    return this.client.post("/api/v1/channels/connect-links", input, options);
  }

  /** List the workspace's connect links (tokens are never returned). */
  async list(options?: ListConnectLinksOptions): Promise<ApiResponse<ConnectLink[]>> {
    const params: Record<string, string | undefined> = {};
    if (options?.channel_type) params.channel_type = options.channel_type;
    if (options?.status) params.status = options.status;
    return this.client.get("/api/v1/channels/connect-links", params);
  }

  /** Revoke a pending connect link so it can no longer be consumed. */
  async revoke(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<ConnectLinkRevokeResult>> {
    return this.client.delete(`/api/v1/channels/connect-links/${encodeURIComponent(id)}`, options);
  }
}

/** List and disconnect the workspace's channel connections. */
class ChannelConnections {
  constructor(private client: BaseClient) {}

  /** List the workspace's channel connections (generic, channel-agnostic shape). */
  async list(): Promise<ApiResponse<ChannelConnection[]>> {
    return this.client.get("/api/v1/channels/connections");
  }

  /**
   * Disconnect a connected channel account (best-effort platform logout, then
   * local revoke). Emits a `helpdesk.channel_disconnected` webhook event with
   * `reason: "api_disconnect"` if the account was previously connected.
   */
  async disconnect(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<ChannelConnectionDisconnectResult>> {
    return this.client.delete(`/api/v1/channels/connections/${encodeURIComponent(id)}`, options);
  }
}

/**
 * Partner channel connect — mint hosted connect links that let an external
 * person (no Medal account required) attach a channel account (e.g.
 * `telegram_inbox`) to the workspace's helpdesk, and manage the resulting
 * connections.
 */
export class Channels {
  readonly connectLinks: ChannelConnectLinks;
  readonly connections: ChannelConnections;

  constructor(client: BaseClient) {
    this.connectLinks = new ChannelConnectLinks(client);
    this.connections = new ChannelConnections(client);
  }
}

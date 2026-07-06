/** A webhook endpoint registered in the workspace. */
export interface WebhookEndpoint {
  id: string;
  name: string;
  /** Destination URL (must be https). */
  url: string;
  enabled: boolean;
  /** Subscribed event types. Empty array = all events. */
  event_types: string[];
  /** Channel-type filter (e.g. ['widget', 'whatsapp']), or `null` for all channels. */
  channels: string[] | null;
  /** Channel-connection filter, or `null` for all connections. */
  channel_connection_ids: string[] | null;
  /** Last 4 characters of the signing secret, for identification. */
  secret_last4: string;
  consecutive_failures: number;
  /** Unix timestamps in milliseconds, or `null` if never. */
  last_delivery_at: number | null;
  last_success_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  /**
   * Full signing secret (`whsec_…`) — present ONLY in the `create` response.
   * It is returned exactly once and can never be retrieved again. Store it
   * securely immediately; you need it to verify delivery signatures.
   */
  secret?: string;
}

/** Input for creating a webhook endpoint. */
export interface CreateWebhookInput {
  /** Display name (max 100 characters). */
  name: string;
  /** Destination URL — must be https. */
  url: string;
  /** Event types to subscribe to (e.g. 'helpdesk.message_received'). Empty = all. */
  event_types: string[];
  /** Restrict to these channel types (e.g. ['widget', 'whatsapp']). */
  channels?: string[];
  /** Restrict to these channel connection IDs. */
  channel_connection_ids?: string[];
}

/** Input for updating a webhook endpoint. Only provided fields change. */
export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  event_types?: string[];
  channels?: string[];
  channel_connection_ids?: string[];
  enabled?: boolean;
}

/** Result of deleting a webhook endpoint. */
export interface WebhookDeleteResult {
  id: string;
  status: string;
}

/** A delivery attempt record for a webhook endpoint. */
export interface WebhookDelivery {
  id: string;
  event_type: string;
  status: "pending" | "delivered" | "dead_letter";
  attempt_count: number;
  /** Unix timestamp in milliseconds of the next retry, or `null`. */
  next_attempt_at: number | null;
  response_status: number | null;
  duration_ms: number | null;
  last_error: string | null;
  /** Unix timestamp in milliseconds, or `null` if not delivered. */
  delivered_at: number | null;
  created_at: number;
}

/** Options for listing recent deliveries. */
export interface ListDeliveriesOptions {
  limit?: number;
}

/** Result returned after queuing a test delivery (HTTP 202). */
export interface WebhookTestResult {
  delivery_id: string;
  status: string;
}

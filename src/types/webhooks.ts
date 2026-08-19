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

/**
 * Input for updating a webhook endpoint. Only provided fields change.
 * Pass `null` for `channels` or `channel_connection_ids` to CLEAR an existing
 * filter (deliver for all channels / all accounts again); omitting the field
 * leaves the current filter unchanged.
 */
export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  event_types?: string[];
  channels?: string[] | null;
  channel_connection_ids?: string[] | null;
  enabled?: boolean;
}

/** Result of deleting a webhook endpoint. */
export interface WebhookDeleteResult {
  id: string;
  status: string;
}

/**
 * A delivery attempt record for a webhook endpoint.
 *
 * `id` is the same value sent as the `X-Medal-Delivery-Id` and
 * `Idempotency-Key` headers on the outbound request, so you can join your own
 * receiving log to this listing exactly.
 *
 * **Deliveries never carry payload bodies.** The event payload can contain
 * customer PII, so it is not returned here — use the correlation fields below
 * to look the subject up through the regular API instead.
 *
 * All correlation fields (`resource_id`, `conversation_id`, `message_id`,
 * `connection_ref`, `channel`, `channel_connection_id`) are derived from the
 * stored event and **fail closed to `null`** whenever no canonical event
 * exists for the delivery — e.g. `test.ping` deliveries, or events that have
 * aged out of retention. Always null-check before using them.
 */
export interface WebhookDelivery {
  id: string;
  event_type: string;
  /**
   * Primary subject id of the announced event (a message id for message
   * events, a connection id for channel lifecycle events, …), or `null`.
   */
  resource_id: string | null;
  /** Helpdesk conversation the event belongs to, or `null`. */
  conversation_id: string | null;
  /** Helpdesk message the event belongs to, or `null`. */
  message_id: string | null;
  /** Opaque connection reference carried by the event, or `null`. */
  connection_ref: string | null;
  /** Channel type (e.g. `telegram_inbox`, `widget`), or `null`. */
  channel: string | null;
  /** Channel connection the event belongs to, or `null`. */
  channel_connection_id: string | null;
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

/**
 * Options for listing recent deliveries.
 *
 * This endpoint is **not** cursor-paginated — it returns the most recent
 * deliveries only, capped by `limit`. There is no `cursor` parameter; to keep
 * a durable record, ingest deliveries as they arrive (or poll and de-duplicate
 * on the delivery `id`).
 */
export interface ListDeliveriesOptions {
  limit?: number;
}

/** Result returned after queuing a test delivery (HTTP 202). */
export interface WebhookTestResult {
  delivery_id: string;
  status: string;
}

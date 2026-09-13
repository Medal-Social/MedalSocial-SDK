/**
 * Webhook event types and signature verification for the Medal Social
 * outbound webhook bridge.
 *
 * Every delivery is an HTTP POST with headers:
 * - `X-Medal-Timestamp` — Unix milliseconds when the request was signed
 * - `X-Medal-Signature` — `sha256=<base64(HMAC-SHA256("{timestamp}.{rawBody}", secret))>`
 * - `X-Medal-Event` — the event type
 * - `X-Medal-Delivery-Id` / `Idempotency-Key` — unique delivery ID (deduplicate on this)
 *
 * Use {@link verifyWebhookSignature} to authenticate a delivery and get the
 * parsed, typed event back. Uses Web Crypto (`crypto.subtle`) so it works in
 * Node.js 18+, Deno, Bun, Cloudflare Workers, and browsers.
 */

import type {
  ContactLinkSource,
  ConversationStatus,
  HelpdeskChannel,
  HelpdeskChatType,
  MessageDeliveryStatus,
} from "./types/helpdesk";

/** Snapshot of a conversation included in every helpdesk webhook event. */
export interface WebhookConversationSnapshot {
  id: string;
  channel: HelpdeskChannel;
  channelConnectionId: string | null;
  status: ConversationStatus;
  subject: string | null;
  assigneeUserId: string | null;
  contactId: string | null;
  /** How `contactId` was attached, or `null` when the thread carries no contact. */
  contactLinkSource: ContactLinkSource | null;
  /** Unix timestamp in milliseconds when the contact was attached, or `null`. */
  contactLinkedAt: number | null;
  visitorName: string | null;
  visitorEmail: string | null;
  externalConversationId: string | null;
  channelAccountId: string | null;
  /** DM / group / channel on personal-account channels (Telegram); `null` elsewhere. */
  chatType: HelpdeskChatType | null;
  /** The external group or channel title; `null` for DMs and business channels. */
  chatTitle: string | null;
  messageCount: number;
  /** Unix timestamp in milliseconds. */
  lastMessageAt: number;
  /** Unix timestamp in milliseconds. */
  createdAt: number;
}

/** Snapshot of a message included in helpdesk message events. */
export interface WebhookMessageSnapshot {
  id: string;
  authorType: "visitor" | "operator" | "ai" | "system";
  messageType: "chat" | "email" | "note";
  body: string;
  authorUserId: string | null;
  authorName: string | null;
  externalMessageId: string | null;
  /** Outbound delivery state — the same values as `ConversationMessage.delivery_status`. */
  deliveryStatus: MessageDeliveryStatus | null;
  deliveryError: string | null;
  /** Unix timestamp in milliseconds. */
  createdAt: number;
}

/** Fields present in the `data` of every helpdesk event. */
interface HelpdeskEventData {
  /** Channel type at the top level, for quick filtering. */
  channel: HelpdeskChannel;
  channelConnectionId: string | null;
  conversation: WebhookConversationSnapshot;
}

/** Envelope fields shared by all webhook events. */
interface WebhookEventBase {
  /** Unique delivery/event ID — use for deduplication. */
  id: string;
  /** Unix timestamp in milliseconds when the event was created. */
  created_at: number;
  workspace_id: string;
}

/** A new conversation was created. */
export interface ConversationCreatedEvent extends WebhookEventBase {
  type: "helpdesk.conversation_created";
  data: HelpdeskEventData;
}

/** A conversation was assigned or unassigned. */
export interface ConversationAssignedEvent extends WebhookEventBase {
  type: "helpdesk.conversation_assigned";
  data: HelpdeskEventData & {
    assigneeUserId: string | null;
    previousAssigneeUserId: string | null;
  };
}

/** A conversation's status changed (open / snoozed / closed). */
export interface ConversationStatusChangedEvent extends WebhookEventBase {
  type: "helpdesk.conversation_status_changed";
  data: HelpdeskEventData & {
    status: ConversationStatus;
    previousStatus: ConversationStatus;
    /**
     * Present only when a new customer message reopened a snoozed or closed
     * thread (`status` is then `open`). Absent when an operator or the API
     * changed the status directly.
     */
    reason?: "message_reopened";
  };
}

/** A message arrived from the visitor/customer. */
export interface MessageReceivedEvent extends WebhookEventBase {
  type: "helpdesk.message_received";
  data: HelpdeskEventData & { message: WebhookMessageSnapshot };
}

/** A message was sent by an operator, AI, or the system. */
export interface MessageSentEvent extends WebhookEventBase {
  type: "helpdesk.message_sent";
  data: HelpdeskEventData & { message: WebhookMessageSnapshot };
}

/** The delivery status of an outbound message changed (sent / delivered / failed …). */
export interface MessageDeliveryUpdatedEvent extends WebhookEventBase {
  type: "helpdesk.message_delivery_updated";
  data: HelpdeskEventData & { message: WebhookMessageSnapshot };
}

/**
 * A message was deleted UPSTREAM on the external platform (Telegram today).
 *
 * `message.body` is deliberately empty — the point of the event is that the
 * content was erased. Mirror the deletion in your own store rather than
 * treating it as a blank message; the message itself is kept by Medal as a
 * tombstone so the thread still reads in order.
 */
export interface MessageDeletedEvent extends WebhookEventBase {
  type: "helpdesk.message_deleted";
  data: HelpdeskEventData & {
    message: WebhookMessageSnapshot;
    /** Unix timestamp in milliseconds when the customer deleted it. */
    deletedAt: number;
    /** Who deleted it — always the customer on the external platform. */
    deletedBy: "external";
  };
}

/**
 * Fields shared by the two identity events. Beyond the usual `conversation`
 * snapshot — whose `contactId`, `contactLinkSource` and `contactLinkedAt`
 * already reflect the change — `data` names the contact that was attached or
 * detached and who did it.
 */
export interface WebhookContactLinkData {
  /** The contact now attached, or `null` after an unlink. */
  contactId: string | null;
  /** The contact that was attached before, or `null` when there was none. */
  previousContactId: string | null;
  /** Who made the change: a member in the inbox, or a partner over the REST API. */
  linkSource: "operator" | "partner";
  /** The channel's own sender reference (a Telegram user id, a phone…), or `null`. */
  externalContactRef: string | null;
}

/**
 * A conversation's sender was bound to a CRM contact — by an operator in the
 * inbox, or by a partner through `PUT /api/v1/helpdesk/conversations/{id}/contact`.
 * Carries the contact's e-mail and display name so a consumer does not have
 * to fetch it. Webhook-only: not an automation trigger.
 */
export interface ConversationContactLinkedEvent extends WebhookEventBase {
  type: "helpdesk.conversation_contact_linked";
  data: HelpdeskEventData &
    WebhookContactLinkData & {
      contactId: string;
      contactEmail: string;
      contactName: string;
      /** Unix timestamp in milliseconds. */
      linkedAt: number;
    };
}

/**
 * A conversation's sender was detached from its CRM contact. `contactId` is
 * `null` and `previousContactId` names the contact that was removed.
 * Webhook-only: not an automation trigger.
 */
export interface ConversationContactUnlinkedEvent extends WebhookEventBase {
  type: "helpdesk.conversation_contact_unlinked";
  data: HelpdeskEventData &
    WebhookContactLinkData & {
      contactId: null;
      previousContactId: string;
      /** Unix timestamp in milliseconds. */
      unlinkedAt: number;
    };
}

/**
 * Fields present in the `data` of channel lifecycle events. Unlike message
 * events there is no conversation snapshot — the payload is channel-generic.
 * `channel` / `channelConnectionId` sit at the top level so endpoint channel
 * filters match exactly like message events.
 */
export interface WebhookChannelLifecycleData {
  /** Helpdesk channel type (e.g. `telegram`), or `null` for non-helpdesk channels. */
  channel: string | null;
  channelConnectionId: string | null;
  /** Connector channel type (e.g. `telegram_inbox`). */
  channel_type: string;
  /** Adapter-defined stable connection ref (matches `consumed_connection_ref` on the connect link). */
  connection_ref: string;
  label: string | null;
  masked_identity: string | null;
}

/** A channel account was connected to the workspace (e.g. via a partner connect link). */
export interface ChannelConnectedEvent extends WebhookEventBase {
  type: "helpdesk.channel_connected";
  data: WebhookChannelLifecycleData;
}

/** Why a channel account was disconnected. */
export type ChannelDisconnectReason = "api_disconnect" | "user_revoked" | "member_disconnect";

/** A previously connected channel account was removed from the workspace. */
export interface ChannelDisconnectedEvent extends WebhookEventBase {
  type: "helpdesk.channel_disconnected";
  data: WebhookChannelLifecycleData & {
    /** Why the account went away. */
    reason?: ChannelDisconnectReason;
  };
}

/** A `test.ping` delivery queued via `medal.webhooks.test(id)`. Carries sample data. */
export interface TestPingEvent extends WebhookEventBase {
  type: "test.ping";
  data: Record<string, unknown>;
}

/**
 * Discriminated union of all webhook events, keyed on `type`.
 *
 * @example
 * ```ts
 * switch (event.type) {
 *   case 'helpdesk.message_received':
 *     console.log(event.data.message.body);
 *     break;
 *   case 'helpdesk.conversation_status_changed':
 *     console.log(event.data.previousStatus, '→', event.data.status);
 *     break;
 * }
 * ```
 */
export type WebhookEvent =
  | ConversationCreatedEvent
  | ConversationAssignedEvent
  | ConversationStatusChangedEvent
  | MessageReceivedEvent
  | MessageSentEvent
  | MessageDeliveryUpdatedEvent
  | MessageDeletedEvent
  | ConversationContactLinkedEvent
  | ConversationContactUnlinkedEvent
  | ChannelConnectedEvent
  | ChannelDisconnectedEvent
  | TestPingEvent;

/**
 * Every event type a delivery can carry — the `type` discriminator of
 * {@link WebhookEvent}, including `test.ping`.
 */
export type WebhookEventType = WebhookEvent["type"];

/**
 * The event types an endpoint can subscribe to: every {@link WebhookEventType}
 * except `test.ping`, which is only ever queued by `medal.webhooks.test(id)`.
 * The API rejects any other string in `event_types` with a `400`.
 */
export type SubscribableWebhookEventType = Exclude<WebhookEventType, "test.ping">;

/** Machine-readable reason a webhook verification failed. */
export type WebhookVerificationErrorCode =
  | "malformed_header"
  | "timestamp_out_of_tolerance"
  | "invalid_signature"
  | "invalid_payload";

/** Thrown by {@link verifyWebhookSignature} when a delivery cannot be authenticated. */
export class WebhookVerificationError extends Error {
  readonly code: WebhookVerificationErrorCode;

  constructor(code: WebhookVerificationErrorCode, message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.code = code;
  }
}

/** Input for {@link verifyWebhookSignature}. */
export interface VerifyWebhookSignatureInput {
  /** The RAW request body string, exactly as received (do not re-serialize parsed JSON). */
  payload: string;
  /** Value of the `X-Medal-Timestamp` header (Unix milliseconds). */
  timestamp: string;
  /** Value of the `X-Medal-Signature` header (`sha256=<base64>`). */
  signature: string;
  /** The endpoint signing secret (`whsec_…`) returned once at creation time. */
  secret: string;
  /** Max allowed clock skew between now and the signed timestamp. Default 5 minutes. */
  toleranceMs?: number;
}

/** Default allowed clock skew for webhook verification (5 minutes). */
export const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify a webhook delivery's signature and timestamp, then return the parsed
 * typed event.
 *
 * Recomputes `HMAC-SHA256("{timestamp}.{payload}", secret)` with Web Crypto
 * and compares it against the signature in constant time. Deliveries whose
 * timestamp deviates from the current time by more than `toleranceMs`
 * (default 5 minutes) are rejected to prevent replay attacks.
 *
 * @throws {WebhookVerificationError} if the headers are malformed, the
 * timestamp is outside the tolerance window, the signature does not match,
 * or the payload is not valid JSON.
 *
 * @example
 * ```ts
 * const event = await verifyWebhookSignature({
 *   payload: rawBody,
 *   timestamp: req.headers['x-medal-timestamp'],
 *   signature: req.headers['x-medal-signature'],
 *   secret: process.env.MEDAL_WEBHOOK_SECRET,
 * });
 * ```
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<WebhookEvent> {
  const { payload, timestamp, signature, secret } = input;
  const toleranceMs = input.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS;

  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    throw new WebhookVerificationError(
      "malformed_header",
      "Signature header must be in the form 'sha256=<base64>'",
    );
  }

  const timestampMs = Number(timestamp);
  if (typeof timestamp !== "string" || timestamp === "" || !Number.isFinite(timestampMs)) {
    throw new WebhookVerificationError(
      "malformed_header",
      "Timestamp header must be a Unix-milliseconds number string",
    );
  }
  if (Math.abs(Date.now() - timestampMs) > toleranceMs) {
    throw new WebhookVerificationError(
      "timestamp_out_of_tolerance",
      `Timestamp is outside the allowed tolerance of ${toleranceMs}ms`,
    );
  }

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64ToBytes(signature.slice("sha256=".length));
  } catch {
    throw new WebhookVerificationError("invalid_signature", "Signature is not valid base64");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // crypto.subtle.verify performs a constant-time comparison internally.
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(`${timestamp}.${payload}`),
  );
  if (!valid) {
    throw new WebhookVerificationError("invalid_signature", "Signature does not match the payload");
  }

  try {
    return JSON.parse(payload) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("invalid_payload", "Payload is not valid JSON");
  }
}

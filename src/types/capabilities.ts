import type { CreateConnectLinkInput } from "./channels";
import type { CreateReplyInput, UpdateConversationInput } from "./helpdesk";
import type { CreateWebhookInput, UpdateWebhookInput } from "./webhooks";

/**
 * Capability confirmation types.
 *
 * Medal's confirmable write routes require BOTH an `Idempotency-Key` and an
 * `X-Capability-Confirmation` token whenever the calling credential holds the
 * capability scope *directly* — which is the case for every correctly-scoped
 * partner key and OAuth grant. (API keys carrying only legacy scopes are
 * exempt.) The token is minted by `POST /api/v1/capability-confirmations` and
 * is bound to the workspace, the auth subject, the HTTP method + path, the
 * capability's required scopes, and the idempotency key.
 */

/**
 * Confirmable capability ids backing the write routes this SDK exposes.
 *
 * Mirrors the server-side capability registry. Each id maps to exactly one
 * method + path template — see {@link CAPABILITY_ROUTES}.
 */
export const CAPABILITY_IDS = [
  "channel.connect_link.create.execute",
  "channel.connect_link.revoke.execute",
  "channel.connection.disconnect.execute",
  "helpdesk.conversation.reply.execute",
  "helpdesk.conversation.update.execute",
  "helpdesk.webhook.create.execute",
  "helpdesk.webhook.update.execute",
  "helpdesk.webhook.delete.execute",
] as const;

/** A confirmable capability id backing an SDK write route. */
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** The API route a capability confirms, as registered server-side. */
export interface CapabilityRoute {
  method: "POST" | "PATCH" | "DELETE";
  /** Path template; `{id}` is filled from `path_params.id`. */
  path_template: string;
}

/**
 * Method + path template for each confirmable capability.
 *
 * The server resolves the same mapping from its capability registry — this
 * copy exists so the SDK can build human-readable previews and supply
 * `path_params` without a round trip.
 */
export const CAPABILITY_ROUTES: Record<CapabilityId, CapabilityRoute> = {
  "channel.connect_link.create.execute": {
    method: "POST",
    path_template: "/api/v1/channels/connect-links",
  },
  "channel.connect_link.revoke.execute": {
    method: "DELETE",
    path_template: "/api/v1/channels/connect-links/{id}",
  },
  "channel.connection.disconnect.execute": {
    method: "DELETE",
    path_template: "/api/v1/channels/connections/{id}",
  },
  "helpdesk.conversation.reply.execute": {
    method: "POST",
    path_template: "/api/v1/helpdesk/replies",
  },
  "helpdesk.conversation.update.execute": {
    method: "PATCH",
    path_template: "/api/v1/helpdesk/conversations/{id}",
  },
  "helpdesk.webhook.create.execute": {
    method: "POST",
    path_template: "/api/v1/webhooks",
  },
  "helpdesk.webhook.update.execute": {
    method: "PATCH",
    path_template: "/api/v1/webhooks/{id}",
  },
  "helpdesk.webhook.delete.execute": {
    method: "DELETE",
    path_template: "/api/v1/webhooks/{id}",
  },
};

/** Primitive accepted as a capability path parameter value. */
export type CapabilityPathParamValue = string | number | boolean;

/** Input for `POST /api/v1/capability-confirmations`. */
export interface IssueCapabilityConfirmationInput {
  /**
   * Capability to confirm. Unknown ids are rejected with
   * `CAPABILITY_NOT_FOUND`; read-only or non-confirmable capabilities with
   * `CAPABILITY_NOT_CONFIRMABLE`.
   */
  capability_id: CapabilityId | (string & {});
  /**
   * Concrete `/api/v1/...` path the token should be bound to. Optional when
   * the capability has exactly one API target (all capabilities in
   * {@link CAPABILITY_ROUTES} do); required when it has several. Must match a
   * path built from the capability's own templates.
   */
  api_path?: string;
  /** Values for the capability path template's parameters, e.g. `{ id: 'wh_1' }`. */
  path_params?: Record<string, CapabilityPathParamValue>;
  /**
   * The exact `Idempotency-Key` you will send on the confirmed write. The
   * token is bound to it — a mismatch is rejected. Required for every
   * capability in {@link CAPABILITY_ROUTES}.
   */
  idempotency_key?: string;
  /**
   * Human-readable description of the action being approved (1–4000 chars).
   * This is the text your user saw and approved, and it is retained for audit.
   */
  preview_summary: string;
  /**
   * Must be `true`.
   *
   * **This asserts that a human on your side approved this specific action.**
   * Do not send it to rubber-stamp unattended writes — it is the audit record
   * that a person, not a script, authorised the change.
   */
  user_approved: true;
}

/** A minted capability confirmation token. */
export interface CapabilityConfirmation {
  /** Send this as the `X-Capability-Confirmation` header on the write. */
  confirmation_token: string;
  token_type: "medal_capability_confirmation";
  capability_id: string;
  /** HTTP method the token is bound to. */
  method: string;
  /** Concrete API path the token is bound to. */
  path: string;
  /** Capability scopes the token was minted against. */
  required_scopes: string[];
  /** Idempotency key the token is bound to, or `null` if it was minted unbound. */
  idempotency_key: string | null;
  /** Lifetime in seconds (60–900). */
  expires_in: number;
  /** ISO-8601 expiry timestamp. */
  expires_at: string;
  /** Echo of the submitted `preview_summary`. */
  preview_summary: string;
}

/**
 * Request body type for each confirmable capability.
 *
 * `undefined` for routes that take no request body (the `DELETE` routes).
 */
export interface CapabilityWriteBodies {
  "channel.connect_link.create.execute": CreateConnectLinkInput;
  "channel.connect_link.revoke.execute": undefined;
  "channel.connection.disconnect.execute": undefined;
  "helpdesk.conversation.reply.execute": CreateReplyInput;
  "helpdesk.conversation.update.execute": UpdateConversationInput;
  "helpdesk.webhook.create.execute": CreateWebhookInput;
  "helpdesk.webhook.update.execute": UpdateWebhookInput;
  "helpdesk.webhook.delete.execute": undefined;
}

/**
 * A capability paired with the request body for that exact route.
 *
 * Modelled as a discriminated union rather than two independent parameters so
 * the pair cannot be decoupled: passing a `helpdesk.conversation.reply.execute`
 * id alongside a webhook payload is a compile error, even when the id's static
 * type is the full {@link CapabilityId} union.
 */
export type CapabilityWriteRequest = {
  [K in CapabilityId]: {
    /** Capability about to be confirmed. */
    capabilityId: K;
    /** The request body of the pending write, or `undefined` for `DELETE` routes. */
    body: CapabilityWriteBodies[K];
  };
}[CapabilityId];

/** Fields common to every {@link AutoConfirmContext} variant. */
interface AutoConfirmContextBase {
  /** HTTP method of the write. */
  method: string;
  /** Resolved API path of the write (path params substituted + encoded). */
  path: string;
  /** Path parameters used to resolve `path`, if any. */
  pathParams?: Record<string, CapabilityPathParamValue>;
  /** Idempotency key that will be bound to the token and sent on the write. */
  idempotencyKey: string;
}

/**
 * Context handed to an {@link AutoConfirmOptions.previewSummary} callback.
 *
 * A discriminated union on `capabilityId` — narrow on it to get the exact
 * `body` type for that route:
 *
 * ```ts
 * previewSummary: (ctx) => {
 *   if (ctx.capabilityId === 'helpdesk.conversation.reply.execute') {
 *     // ctx.body is CreateReplyInput here
 *     return `Reply to ${ctx.body.conversation_id}: ${ctx.body.body}`;
 *   }
 *   return `${ctx.method} ${ctx.path}`;
 * }
 * ```
 *
 * `body` is the **exact object you passed to the SDK method**, by reference
 * and unmodified — it is your own payload, so there is nothing to redact and
 * nothing crosses a tenant boundary. Treat it as read-only: mutating it from
 * the callback would change what is actually sent.
 */
export type AutoConfirmContext = AutoConfirmContextBase & CapabilityWriteRequest;

/**
 * Opt-in auto-confirmation.
 *
 * When configured, the SDK mints an idempotency key and a confirmation token
 * for you before each confirmable write, then attaches both headers.
 *
 * **This is not a bypass.** Every minted token carries
 * `user_approved: true`, which asserts that *your own user* approved that
 * specific action — the `preview_summary` you return is the audit record of
 * what they approved. Only enable this on a code path where a human really did
 * approve the write. Never wire it into unattended automation.
 */
export interface AutoConfirmOptions {
  /**
   * Build the `preview_summary` for the pending write. Must return a
   * non-empty string describing what the user approved; returning blank text
   * throws instead of asserting an approval that has no description.
   *
   * The context includes the pending request `body`, so the summary can name
   * the specific action rather than the route — narrow on
   * `context.capabilityId` to get the exact payload type. Prefer a
   * payload-aware summary: `"Reply to conv_1: 'Refund issued'"` is an audit
   * record, `"POST /api/v1/helpdesk/replies"` is not.
   *
   * The server caps `preview_summary` at 4000 characters, so summarise the
   * payload rather than serialising it wholesale.
   */
  previewSummary: (context: AutoConfirmContext) => string;
}

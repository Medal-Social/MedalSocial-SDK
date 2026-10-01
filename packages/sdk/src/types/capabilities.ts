import type { CreateConnectLinkInput } from "./channels";
import type { AddNoteInput } from "./contacts";
import type { CreateDealInput, UpdateDealInput } from "./deals";
import type { BatchSendInput, SendEmailInput } from "./emails";
import type {
  CreateReplyInput,
  LinkConversationContactInput,
  UpdateConversationInput,
} from "./helpdesk";
import type { CreatePostInput, SchedulePostInput } from "./posts";
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
 * Every confirmable capability the server registers against a public API route.
 *
 * Mirrors the server-side capability registry — the whole of it, not just the
 * routes this SDK wraps. The first version of this list named 8 ids (the
 * helpdesk-bridge routes), so `autoConfirmCapabilities` silently did nothing
 * for deals, contacts, posts, e-mails and GDPR exports, and a capability-scoped
 * key calling `deals.update` had no way to reach a `428` route at all.
 *
 * Ids the SDK has no method for are listed too: they are still valid input to
 * `medal.capabilityConfirmations.create(...)`, which is how an integrator mints
 * a token for a route it calls with `fetch` (AI generation, image generation,
 * flow enrollments, Sanity documents, media assets, post media, e-mail drafts,
 * the Telegram sync config).
 *
 * Each id maps to a method + path template — see {@link CAPABILITY_ROUTES}.
 */
export const CAPABILITY_IDS = [
  "ai.text.generate",
  "channel.connect_link.create.execute",
  "channel.connect_link.revoke.execute",
  "channel.connection.disconnect.execute",
  "channel.telegram_sync_config.update.execute",
  "compliance.gdpr.export.execute",
  "content.post.draft.create",
  "content.post.media.attach.execute",
  "content.post.publish.execute",
  "content.post.schedule.execute",
  "crm.contact.note.create.execute",
  "deals.deal.create.execute",
  "deals.deal.update.execute",
  "email.campaign.send.execute",
  "email.draft.create.execute",
  "flows.enrollment.create.execute",
  "helpdesk.conversation.link_contact.execute",
  "helpdesk.conversation.reply.execute",
  "helpdesk.conversation.unlink_contact.execute",
  "helpdesk.conversation.update.execute",
  "helpdesk.webhook.create.execute",
  "helpdesk.webhook.update.execute",
  "helpdesk.webhook.delete.execute",
  "image.generation.execute",
  "media.generated_asset.save.execute",
  "site.sanity.document.create.execute",
  "site.sanity.document.update.execute",
] as const;

/** A confirmable capability id backing an SDK write route. */
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** The API route a capability confirms, as registered server-side. */
export interface CapabilityRoute {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path template; `{id}` is filled from `path_params.id`. */
  path_template: string;
  /**
   * Further paths the SAME capability id confirms, when the server registry
   * binds several routes to it (`email.campaign.send.execute` covers both the
   * single send and the batch; `ai.text.generate` covers the AI and Pilot
   * entry points).
   *
   * It matters because `POST /api/v1/capability-confirmations` then REFUSES a
   * request that does not say which one — `400 CAPABILITY_API_PATH_REQUIRED` —
   * so the SDK sends an explicit `api_path` for these and only these.
   */
  alternate_path_templates?: readonly string[];
}

/**
 * Method + path template for each confirmable capability.
 *
 * The server resolves the same mapping from its capability registry — this
 * copy exists so the SDK can build human-readable previews and supply
 * `path_params` without a round trip.
 */
export const CAPABILITY_ROUTES: Record<CapabilityId, CapabilityRoute> = {
  "ai.text.generate": {
    method: "POST",
    path_template: "/api/v1/ai/generate",
    alternate_path_templates: ["/api/v1/pilot/ask"],
  },
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
  "channel.telegram_sync_config.update.execute": {
    method: "PATCH",
    path_template: "/api/v1/channels/telegram/sync-config",
  },
  "compliance.gdpr.export.execute": {
    method: "POST",
    path_template: "/api/v1/gdpr/export",
  },
  "content.post.draft.create": {
    method: "POST",
    path_template: "/api/v1/posts",
  },
  "content.post.media.attach.execute": {
    method: "POST",
    path_template: "/api/v1/posts/{id}/media",
  },
  "content.post.publish.execute": {
    method: "POST",
    path_template: "/api/v1/posts/{id}/publish",
  },
  "content.post.schedule.execute": {
    method: "POST",
    path_template: "/api/v1/posts/{id}/schedule",
  },
  "crm.contact.note.create.execute": {
    method: "POST",
    path_template: "/api/v1/contacts/{id}/notes",
  },
  "deals.deal.create.execute": {
    method: "POST",
    path_template: "/api/v1/deals",
  },
  "deals.deal.update.execute": {
    method: "PATCH",
    path_template: "/api/v1/deals/{id}",
  },
  "email.campaign.send.execute": {
    method: "POST",
    path_template: "/api/v1/emails",
    alternate_path_templates: ["/api/v1/emails/batch"],
  },
  "email.draft.create.execute": {
    method: "POST",
    path_template: "/api/v1/emails/drafts",
  },
  "flows.enrollment.create.execute": {
    method: "POST",
    path_template: "/api/v1/flows/enrollments",
  },
  "helpdesk.conversation.link_contact.execute": {
    method: "PUT",
    path_template: "/api/v1/helpdesk/conversations/{id}/contact",
  },
  "helpdesk.conversation.reply.execute": {
    method: "POST",
    path_template: "/api/v1/helpdesk/replies",
  },
  "helpdesk.conversation.unlink_contact.execute": {
    method: "DELETE",
    path_template: "/api/v1/helpdesk/conversations/{id}/contact",
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
  "image.generation.execute": {
    method: "POST",
    path_template: "/api/v1/images/generations",
  },
  "media.generated_asset.save.execute": {
    method: "POST",
    path_template: "/api/v1/media/generated-assets",
  },
  "site.sanity.document.create.execute": {
    method: "POST",
    path_template: "/api/v1/site/sanity/documents",
  },
  "site.sanity.document.update.execute": {
    method: "PATCH",
    path_template: "/api/v1/site/sanity/documents/{id}",
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
 * `undefined` for routes that take no request body (the `DELETE` routes, the
 * GDPR export, a post publish). `unknown` for the confirmable routes this SDK
 * has no method for: the id is still mintable, but the SDK cannot claim to
 * know the payload's shape.
 */
export interface CapabilityWriteBodies {
  "ai.text.generate": unknown;
  "channel.connect_link.create.execute": CreateConnectLinkInput;
  "channel.connect_link.revoke.execute": undefined;
  "channel.connection.disconnect.execute": undefined;
  "channel.telegram_sync_config.update.execute": unknown;
  "compliance.gdpr.export.execute": undefined;
  "content.post.draft.create": CreatePostInput;
  "content.post.media.attach.execute": unknown;
  "content.post.publish.execute": undefined;
  "content.post.schedule.execute": SchedulePostInput;
  "crm.contact.note.create.execute": AddNoteInput;
  "deals.deal.create.execute": CreateDealInput;
  "deals.deal.update.execute": UpdateDealInput;
  "email.campaign.send.execute": SendEmailInput | BatchSendInput;
  "email.draft.create.execute": unknown;
  "flows.enrollment.create.execute": unknown;
  "helpdesk.conversation.link_contact.execute": LinkConversationContactInput;
  "helpdesk.conversation.reply.execute": CreateReplyInput;
  "helpdesk.conversation.unlink_contact.execute": undefined;
  "helpdesk.conversation.update.execute": UpdateConversationInput;
  "helpdesk.webhook.create.execute": CreateWebhookInput;
  "helpdesk.webhook.update.execute": UpdateWebhookInput;
  "helpdesk.webhook.delete.execute": undefined;
  "image.generation.execute": unknown;
  "media.generated_asset.save.execute": unknown;
  "site.sanity.document.create.execute": unknown;
  "site.sanity.document.update.execute": unknown;
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
    /**
     * Which of the capability's routes this write is for, when the capability
     * has {@link CapabilityRoute.alternate_path_templates}. Defaults to the
     * route's `path_template` — so `emails.send` needs nothing and
     * `emails.batch` names `/api/v1/emails/batch`.
     */
    pathTemplate?: string;
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

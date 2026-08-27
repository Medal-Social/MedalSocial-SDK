/**
 * Official TypeScript SDK for the Medal Social API.
 *
 * Provides typed access to posts, emails, contacts, deals, bookings, GDPR
 * compliance, helpdesk conversations, partner channel connect, webhooks, and
 * workspace management. Works in
 * Node.js, Deno, Bun, Cloudflare Workers, and modern browsers.
 *
 * @example
 * ```ts
 * import { Medal } from "@medalsocial/sdk";
 *
 * const medal = new Medal("medal_xxx");
 * const { data: post } = await medal.posts.create({
 *   content: "Hello world!",
 *   channel_ids: ["ch_1"],
 * });
 * ```
 *
 * @module
 */
import { CapabilityConfirmer } from "./capability-confirmer";
import { BaseClient } from "./client";
import { Bookings } from "./resources/bookings";
import { CapabilityConfirmations } from "./resources/capability-confirmations";
import { Channels } from "./resources/channels";
import { Contacts } from "./resources/contacts";
import { Deals } from "./resources/deals";
import { Emails } from "./resources/emails";
import { Gdpr } from "./resources/gdpr";
import { Helpdesk } from "./resources/helpdesk";
import { Posts } from "./resources/posts";
import { Scan } from "./resources/scan";
import { Webhooks } from "./resources/webhooks";
import { Workspaces } from "./resources/workspaces";
import type { AutoConfirmOptions } from "./types/capabilities";

/** Options for configuring the {@link Medal} client. */
export interface MedalOptions {
  /** Override the base URL (defaults to https://io.medalsocial.com). */
  baseUrl?: string;
  /** Request timeout in ms (default 30000). */
  timeout?: number;
  /**
   * Workspace ID — required for OAuth access tokens, ignored for API keys.
   * API keys are scoped to a single workspace, so the workspace is inferred.
   * OAuth tokens can access multiple workspaces, so you must specify which one.
   */
  workspaceId?: string;
  /**
   * Opt in to automatic capability confirmation for confirmable writes.
   * **Defaults to OFF.**
   *
   * Medal's confirmable write routes (connect links, channel connections,
   * helpdesk replies/updates, webhook endpoint writes) require BOTH an
   * `Idempotency-Key` and an `X-Capability-Confirmation` token whenever the
   * credential holds the capability scope directly — which is the case for
   * every correctly-scoped partner key. With this option set, the SDK mints
   * both for you before each such write instead of making you hand-roll
   * `POST /api/v1/capability-confirmations`.
   *
   * **Read before enabling:** each minted token carries `user_approved: true`,
   * which asserts to Medal that *a human on your side approved that specific
   * action*, and the `previewSummary` you return is retained as the audit
   * record of what they approved. Enable it only on code paths where that is
   * genuinely true — never to rubber-stamp unattended writes. Pass
   * `{ autoConfirm: false }` on an individual call to opt out again, or use
   * `medal.capabilityConfirmations.create(...)` for full manual control.
   *
   * @example
   * ```ts
   * const medal = new Medal('medal_xxx', {
   *   autoConfirmCapabilities: {
   *     previewSummary: (ctx) =>
   *       `${operator.email} approved ${ctx.method} ${ctx.path}`,
   *   },
   * });
   * ```
   */
  autoConfirmCapabilities?: AutoConfirmOptions;
}

/**
 * Medal Social SDK client.
 *
 * Supports both API key and OAuth access token authentication:
 *
 * @example API Key (recommended for server-side)
 * ```ts
 * import { Medal } from '@medalsocial/sdk';
 *
 * // API keys start with medal_ and are scoped to one workspace
 * const medal = new Medal('medal_xxx');
 * ```
 *
 * @example OAuth Access Token
 * ```ts
 * // OAuth tokens require a workspaceId
 * const medal = new Medal('oauth_access_token', {
 *   workspaceId: 'workspace_id_here',
 * });
 * ```
 *
 * @example Full usage
 * ```ts
 * const medal = new Medal('medal_xxx');
 *
 * // Posts — create, schedule, publish
 * const { data: post } = await medal.posts.create({
 *   content: 'Hello world!',
 *   channel_ids: ['ch_1'],
 * });
 * await medal.posts.schedule(post.id, { scheduled_at: '2026-03-15T10:00:00Z' });
 *
 * // Emails — send transactional emails
 * await medal.emails.send({
 *   template_slug: 'welcome',
 *   to: 'user@example.com',
 *   variables: { name: 'John' },
 * });
 *
 * // Bookings — free slots, then book a party (money is integer øre)
 * const { data: slots } = await medal.bookings.availability({
 *   service_id: 'svc_1',
 *   from_ts: Date.now(),
 *   to_ts: Date.now() + 7 * 86_400_000,
 * });
 *
 * // Contacts, Deals, GDPR, Workspaces
 * const contacts = await medal.contacts.list({ status: 'lead' });
 * const { data: deal } = await medal.deals.create({ title: 'Acme', value: 50000 });
 * await medal.gdpr.recordConsent({ email: 'u@x.com', consent_type: 'marketing_email', granted: true });
 * const { data: workspaces } = await medal.workspaces.list();
 * ```
 */
export class Medal {
  readonly bookings: Bookings;
  readonly capabilityConfirmations: CapabilityConfirmations;
  readonly channels: Channels;
  readonly emails: Emails;
  readonly contacts: Contacts;
  readonly deals: Deals;
  readonly gdpr: Gdpr;
  readonly helpdesk: Helpdesk;
  readonly posts: Posts;
  readonly scan: Scan;
  readonly webhooks: Webhooks;
  readonly workspaces: Workspaces;

  constructor(token: string, options?: MedalOptions) {
    if (!token) {
      throw new Error(
        "Authentication token is required. Pass your medal_xxx API key or OAuth access token as the first argument.",
      );
    }

    const client = new BaseClient({
      baseUrl: (options?.baseUrl ?? "https://io.medalsocial.com").replace(/\/$/, ""),
      token,
      workspaceId: options?.workspaceId,
      timeout: options?.timeout ?? 30000,
      userAgent: "medalsocial-sdk/1.0.0 (+https://github.com/Medal-Social/MedalSocial)",
    });

    this.capabilityConfirmations = new CapabilityConfirmations(client);
    const confirmer = new CapabilityConfirmer(
      this.capabilityConfirmations,
      options?.autoConfirmCapabilities,
    );

    this.bookings = new Bookings(client);
    this.channels = new Channels(client, confirmer);
    this.emails = new Emails(client);
    this.contacts = new Contacts(client);
    this.deals = new Deals(client);
    this.gdpr = new Gdpr(client);
    this.helpdesk = new Helpdesk(client, confirmer);
    this.posts = new Posts(client);
    this.scan = new Scan(client);
    this.webhooks = new Webhooks(client, confirmer);
    this.workspaces = new Workspaces(client);
  }
}

export { CapabilityConfirmer } from "./capability-confirmer";
export type { RequestOptions } from "./client";
export { BaseClient } from "./client";
export type {
  components as OpenApiComponents,
  operations as OpenApiOperations,
  paths as OpenApiPaths,
} from "./openapi.generated";
// Resource class re-exports (for advanced usage)
export { Bookings } from "./resources/bookings";
export { CapabilityConfirmations } from "./resources/capability-confirmations";
export { Channels } from "./resources/channels";
export { Contacts } from "./resources/contacts";
export { Deals } from "./resources/deals";
export { Emails } from "./resources/emails";
export { Gdpr } from "./resources/gdpr";
export { Helpdesk } from "./resources/helpdesk";
export { Posts } from "./resources/posts";
export { Scan } from "./resources/scan";
export { Webhooks } from "./resources/webhooks";
export { Workspaces } from "./resources/workspaces";
export type {
  Booking,
  BookingActionResult,
  BookingAvailabilityOptions,
  BookingCancelledBy,
  BookingContactInput,
  BookingCreatedVia,
  BookingCreateResult,
  BookingPaymentStatus,
  BookingRescheduleResult,
  BookingResource,
  BookingResourceType,
  BookingService,
  BookingSlot,
  BookingStatus,
  BookingsPage,
  BookingsPagination,
  BookingTimestampInput,
  CancelBookingInput,
  CreateBookingInput,
  CreateBookingItemInput,
  CreatedBooking,
  ListBookingServicesOptions,
  ListBookingsOptions,
  ManageSummary,
  RescheduleBookingInput,
  UpdateBookingInput,
} from "./types/bookings";
export type {
  AutoConfirmContext,
  AutoConfirmOptions,
  CapabilityConfirmation,
  CapabilityId,
  CapabilityPathParamValue,
  CapabilityRoute,
  CapabilityWriteBodies,
  CapabilityWriteRequest,
  IssueCapabilityConfirmationInput,
} from "./types/capabilities";
export { CAPABILITY_IDS, CAPABILITY_ROUTES } from "./types/capabilities";
export type {
  ChannelConnection,
  ChannelConnectionDisconnectResult,
  ChannelConnectionState,
  ConnectLink,
  ConnectLinkCreateResult,
  ConnectLinkRevokeResult,
  ConnectLinkStatus,
  CreateConnectLinkInput,
  ListConnectLinksOptions,
} from "./types/channels";
export type { ApiResponse, PaginatedResponse, PaginationOptions } from "./types/common";
// Re-export all types
export { MedalApiError } from "./types/common";
export type {
  Activity,
  AddNoteInput,
  Contact,
  ContactCreateResult,
  ContactNoteResult,
  ContactRemoveResult,
  ContactStatus,
  ContactUpdateResult,
  CreateContactInput,
  EmailStatus,
  ImportContactInput,
  ImportContactsResult,
  ListContactsOptions,
  UpdateContactInput,
} from "./types/contacts";
export type {
  CreateDealInput,
  Deal,
  DealCreateResult,
  DealRemoveResult,
  DealStatus,
  DealUpdateResult,
  ListDealsOptions,
  UpdateDealInput,
} from "./types/deals";
export type {
  BatchSendInput,
  BatchSendResult,
  BatchSendSummary,
  EmailSend,
  EmailSendResult,
  EmailTemplate,
  EmailTemplateDetail,
  GetTemplateOptions,
  SendEmailInput,
} from "./types/emails";
export type {
  ConsentRecord,
  ConsentResult,
  ConsentType,
  ContactConsents,
  CookieCategoryConsent,
  CookieConsentInput,
  GdprExport,
  RecordConsentInput,
} from "./types/gdpr";
export type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ConversationUpdateResult,
  CreateReplyInput,
  HelpdeskMessageType,
  ListConversationsOptions,
  MessageAuthorType,
  MessageDeliveryStatus,
  ReplyCreateResult,
  UpdateConversationInput,
} from "./types/helpdesk";
export type {
  Channel,
  CreatePostInput,
  ListPostsOptions,
  Post,
  PostDetail,
  PostType,
  PostVariant,
  PublishResult,
  SchedulePostInput,
  ScheduleResult,
  UpdatePostInput,
} from "./types/posts";
export type {
  ScanCompany,
  ScanCreateInput,
  ScanCreateResult,
  ScanJob,
  ScanResultPayload,
  ScanStatus,
  ScanSubScores,
  WaitForScanOptions,
} from "./types/scan";
export type {
  CreateWebhookInput,
  ListDeliveriesOptions,
  UpdateWebhookInput,
  WebhookDeleteResult,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookTestResult,
} from "./types/webhooks";
export type { Workspace } from "./types/workspaces";
export type {
  ChannelConnectedEvent,
  ChannelDisconnectedEvent,
  ChannelDisconnectReason,
  ConversationAssignedEvent,
  ConversationCreatedEvent,
  ConversationStatusChangedEvent,
  MessageDeliveryUpdatedEvent,
  MessageReceivedEvent,
  MessageSentEvent,
  TestPingEvent,
  VerifyWebhookSignatureInput,
  WebhookChannelLifecycleData,
  WebhookConversationSnapshot,
  WebhookEvent,
  WebhookMessageSnapshot,
  WebhookVerificationErrorCode,
} from "./webhook-events";
// Webhook event verification + typed events
export {
  DEFAULT_WEBHOOK_TOLERANCE_MS,
  verifyWebhookSignature,
  WebhookVerificationError,
} from "./webhook-events";

/** Convenience factory — equivalent to `new Medal(apiKey, options)`. */
export function createMedalClient(apiKey: string, options?: MedalOptions): Medal {
  return new Medal(apiKey, options);
}

export default Medal;

import { BaseClient } from "./client";
import { Contacts } from "./resources/contacts";
import { Deals } from "./resources/deals";
import { Emails } from "./resources/emails";
import { Gdpr } from "./resources/gdpr";
import { Posts } from "./resources/posts";
import { Workspaces } from "./resources/workspaces";

export interface MedalOptions {
  /** Override the base URL (defaults to https://api.medalsocial.com). */
  baseUrl?: string;
  /** Request timeout in ms (default 30000). */
  timeout?: number;
  /**
   * Workspace ID — required for OAuth access tokens, ignored for API keys.
   * API keys are scoped to a single workspace, so the workspace is inferred.
   * OAuth tokens can access multiple workspaces, so you must specify which one.
   */
  workspaceId?: string;
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
 * // Contacts, Deals, GDPR, Workspaces
 * const contacts = await medal.contacts.list({ status: 'lead' });
 * const { data: deal } = await medal.deals.create({ title: 'Acme', value: 50000 });
 * await medal.gdpr.recordConsent({ email: 'u@x.com', consent_type: 'marketing_email', granted: true });
 * const { data: workspaces } = await medal.workspaces.list();
 * ```
 */
export class Medal {
  readonly emails: Emails;
  readonly contacts: Contacts;
  readonly deals: Deals;
  readonly gdpr: Gdpr;
  readonly posts: Posts;
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

    this.emails = new Emails(client);
    this.contacts = new Contacts(client);
    this.deals = new Deals(client);
    this.gdpr = new Gdpr(client);
    this.posts = new Posts(client);
    this.workspaces = new Workspaces(client);
  }
}

// Re-export all types
export { MedalApiError } from "./types/common";
export type { ApiResponse, PaginatedResponse, PaginationOptions } from "./types/common";
export type {
  SendEmailInput,
  EmailSendResult,
  EmailSend,
  BatchSendInput,
  BatchSendSummary,
  BatchSendResult,
  EmailTemplate,
  EmailTemplateDetail,
  GetTemplateOptions,
} from "./types/emails";
export type {
  Contact,
  ContactCreateResult,
  ContactUpdateResult,
  ContactRemoveResult,
  ContactNoteResult,
  ContactStatus,
  EmailStatus,
  CreateContactInput,
  UpdateContactInput,
  ListContactsOptions,
  ImportContactInput,
  ImportContactsResult,
  Activity,
  AddNoteInput,
} from "./types/contacts";
export type {
  Deal,
  DealCreateResult,
  DealUpdateResult,
  DealRemoveResult,
  DealStatus,
  CreateDealInput,
  UpdateDealInput,
  ListDealsOptions,
} from "./types/deals";
export type {
  GdprExport,
  ConsentType,
  RecordConsentInput,
  ConsentRecord,
  ConsentResult,
  ContactConsents,
  CookieConsentInput,
  CookieCategoryConsent,
} from "./types/gdpr";
export type {
  Post,
  PostType,
  PostVariant,
  PostDetail,
  Channel,
  CreatePostInput,
  UpdatePostInput,
  SchedulePostInput,
  ListPostsOptions,
  ScheduleResult,
  PublishResult,
} from "./types/posts";
export type { Workspace } from "./types/workspaces";

// Resource class re-exports (for advanced usage)
export { Emails } from "./resources/emails";
export { Contacts } from "./resources/contacts";
export { Deals } from "./resources/deals";
export { Gdpr } from "./resources/gdpr";
export { Posts } from "./resources/posts";
export { Workspaces } from "./resources/workspaces";
export { BaseClient } from "./client";

export default Medal;

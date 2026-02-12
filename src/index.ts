import { BaseClient } from "./client";
import { Contacts } from "./resources/contacts";
import { Deals } from "./resources/deals";
import { Emails } from "./resources/emails";
import { Gdpr } from "./resources/gdpr";

export interface MedalOptions {
  /** Override the base URL (defaults to Convex site URL). */
  baseUrl?: string;
  /** Request timeout in ms (default 30000). */
  timeout?: number;
}

/**
 * Medal Social SDK client.
 *
 * @example
 * ```ts
 * import { Medal } from '@medalsocial/sdk';
 *
 * const medal = new Medal('medal_xxx');
 *
 * // Send an email
 * const { data } = await medal.emails.send({
 *   template_slug: 'welcome',
 *   to: 'user@example.com',
 *   variables: { name: 'John' },
 * });
 *
 * // List contacts
 * const contacts = await medal.contacts.list({ status: 'lead', limit: 50 });
 *
 * // Create a deal
 * const deal = await medal.deals.create({ title: 'Acme Partnership', value: 50000 });
 *
 * // Record GDPR consent
 * await medal.gdpr.recordConsent({
 *   email: 'user@example.com',
 *   consent_type: 'marketing_email',
 *   granted: true,
 * });
 * ```
 */
export class Medal {
  readonly emails: Emails;
  readonly contacts: Contacts;
  readonly deals: Deals;
  readonly gdpr: Gdpr;

  constructor(apiKey: string, options?: MedalOptions) {
    if (!apiKey) {
      throw new Error("API key is required. Pass your medal_xxx key as the first argument.");
    }

    const client = new BaseClient({
      baseUrl: (options?.baseUrl ?? "https://api.medalsocial.com").replace(/\/$/, ""),
      apiKey,
      timeout: options?.timeout ?? 30000,
      userAgent: `medalsocial-sdk/1.0.0 (+https://github.com/Medal-Social/MedalSocial)`,
    });

    this.emails = new Emails(client);
    this.contacts = new Contacts(client);
    this.deals = new Deals(client);
    this.gdpr = new Gdpr(client);
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
  BatchSendResult,
  EmailTemplate,
} from "./types/emails";
export type {
  Contact,
  ContactStatus,
  EmailStatus,
  CreateContactInput,
  UpdateContactInput,
  ListContactsOptions,
  ImportContactsResult,
  Activity,
  AddNoteInput,
} from "./types/contacts";
export type {
  Deal,
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

// Resource class re-exports (for advanced usage)
export { Emails } from "./resources/emails";
export { Contacts } from "./resources/contacts";
export { Deals } from "./resources/deals";
export { Gdpr } from "./resources/gdpr";
export { BaseClient } from "./client";

export default Medal;

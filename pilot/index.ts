import { z } from "zod";
import type { Medal } from "../src/index.js";

const SendEmailSchema = z.object({
  template_slug: z.string(),
  to: z.email(),
  name: z.string().optional(),
  locale: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

const CreateContactSchema = z.object({
  email: z.email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  job_title: z.string().optional(),
  status: z.enum(["lead", "subscriber", "customer", "churned"]).optional(),
  notes: z.string().optional(),
});

const AddContactNoteSchema = z.object({
  contactId: z.string(),
  content: z.string(),
});

// Bounds mirror the endpoint's own schema, so an over-long value fails here
// rather than costing a round trip to be told the same thing.
const CookieConsentSchema = z.object({
  event: z.enum([
    "preferences_saved",
    "preferences_revoked",
    "banner_displayed",
    "preferences_expired",
  ]),
  consentId: z.string().min(1).max(128),
  domain: z.string().min(1).max(253),
  // `.strict()` mirrors the endpoint, which REJECTS an unknown category rather
  // than dropping it. A non-strict object would let a misspelled category be
  // stripped here and the event recorded without that decision — a consent
  // record that silently disagrees with what the caller asked for.
  categories: z
    .object({
      essential: z.boolean().optional(),
      analytics: z.boolean().optional(),
      marketing: z.boolean().optional(),
      functional: z.boolean().optional(),
    })
    .strict(),
  visitorId: z.string().max(128).optional(),
  ipAddress: z.string().max(64).optional(),
  userAgent: z.string().max(512).optional(),
  consentText: z.string().max(2000).optional(),
  policyVersion: z.string().max(64).optional(),
  timestamp: z.number().optional(),
});

const RecordConsentSchema = z.object({
  email: z.email(),
  consent_type: z.enum(["marketing_email", "analytics_tracking", "third_party_sharing"]),
  granted: z.boolean(),
  source: z.string().optional(),
  ip_address: z.string().optional(),
});

const CreateDealSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  /** MAJOR currency units — 50000 is fifty thousand kroner, not 500. */
  value: z.number().optional(),
  // The four codes the API validates against; a tool that offered any string
  // would let an agent send one the API answers 400 for.
  currency: z.enum(["USD", "EUR", "GBP", "NOK"]).optional(),
  contact_email: z.email().optional(),
  notes: z.string().optional(),
});

export function createMedalTools(client: Medal) {
  return {
    sendEmail: {
      description: "Send a transactional email using a template",
      parameters: SendEmailSchema,
      execute: async (args: z.infer<typeof SendEmailSchema>) => client.emails.send(args),
    },
    createContact: {
      description: "Create a new contact in Medal Social CRM",
      parameters: CreateContactSchema,
      execute: async (args: z.infer<typeof CreateContactSchema>) => client.contacts.create(args),
    },
    addContactNote: {
      description: "Add a note to a contact's timeline",
      parameters: AddContactNoteSchema,
      execute: async (args: z.infer<typeof AddContactNoteSchema>) =>
        client.contacts.addNote(args.contactId, { content: args.content }),
    },
    recordCookieConsent: {
      description: "Record a user's cookie consent preferences",
      parameters: CookieConsentSchema,
      execute: async (args: z.infer<typeof CookieConsentSchema>) => client.gdpr.cookieConsent(args),
    },
    recordConsent: {
      description: "Record a GDPR consent decision for a contact by email",
      parameters: RecordConsentSchema,
      execute: async (args: z.infer<typeof RecordConsentSchema>) => client.gdpr.recordConsent(args),
    },
    createDeal: {
      description: "Create a new deal in Medal Social CRM",
      parameters: CreateDealSchema,
      execute: async (args: z.infer<typeof CreateDealSchema>) => client.deals.create(args),
    },
  };
}

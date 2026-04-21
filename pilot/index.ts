import { z } from "zod";
import type { Medal } from "../src/index.js";

const SendEmailSchema = z.object({
  template_slug: z.string(),
  to: z.string().email(),
  name: z.string().optional(),
  locale: z.string().optional(),
  variables: z.record(z.string()).optional(),
});

const CreateContactSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  job_title: z.string().optional(),
  status: z.enum(["lead", "prospect", "customer", "churned", "archived"]).optional(),
  notes: z.string().optional(),
});

const AddContactNoteSchema = z.object({
  contactId: z.string(),
  content: z.string(),
});

const CookieConsentSchema = z.object({
  domain: z.string(),
  consentStatus: z.enum(["granted", "denied", "partial"]),
  consentTimestamp: z.string(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  cookiePreferences: z.object({
    necessary: z.object({ allowed: z.boolean() }).optional(),
    analytics: z.object({ allowed: z.boolean() }).optional(),
    marketing: z.object({ allowed: z.boolean() }).optional(),
    functional: z.object({ allowed: z.boolean() }).optional(),
  }),
});

const RecordConsentSchema = z.object({
  email: z.string().email(),
  consent_type: z.enum(["marketing_email", "analytics_tracking", "third_party_sharing"]),
  granted: z.boolean(),
  source: z.string().optional(),
  ip_address: z.string().optional(),
});

const CreateDealSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
  contact_email: z.string().email().optional(),
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

import { z } from "zod";
import type { MedalSocialClient } from "../src/index.js";

const LeadItemSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  company: z.string().optional(),
  source: z.string().optional(),
});

const ContactNoteSchema = z.object({
  contactId: z.string(),
  note: z.string(),
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

const EventSignupSchema = z.object({
  contact: z.object({
    name: z.string(),
    email: z.string().email(),
    company: z.string().optional(),
  }),
  event: z.object({
    externalId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    time: z.string(),
    location: z.string().optional(),
    thumbnail: z.string().optional(),
  }),
});

const NoteSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  content: z.string().optional(),
});

const TransactionalEmailSchema = z.object({
  to: z.string().email(),
  slug: z.string(),
  additionalData: z.record(z.unknown()).optional(),
});

export function createMedalTools(client: MedalSocialClient) {
  return {
    createLead: {
      description: "Create one or more leads in Medal Social CRM",
      parameters: z.object({ items: z.array(LeadItemSchema) }),
      execute: async (args: { items: z.infer<typeof LeadItemSchema>[] }) =>
        client.createLead(args.items),
    },
    createContactNote: {
      description: "Attach a note to a contact by ID",
      parameters: ContactNoteSchema,
      execute: async (args: z.infer<typeof ContactNoteSchema>) => client.createContactNote(args),
    },
    createCookieConsent: {
      description: "Record a user's cookie consent preferences",
      parameters: CookieConsentSchema,
      execute: async (args: z.infer<typeof CookieConsentSchema>) =>
        client.createCookieConsent(args),
    },
    createEventSignup: {
      description: "Create an event signup with contact and event details",
      parameters: EventSignupSchema,
      execute: async (args: z.infer<typeof EventSignupSchema>) => client.createEventSignup(args),
    },
    createNote: {
      description: "Create a free-form note for inbound messages",
      parameters: NoteSchema,
      execute: async (args: z.infer<typeof NoteSchema>) => client.createNote(args),
    },
    sendTransactionalEmail: {
      description: "Send a transactional email by template slug",
      parameters: TransactionalEmailSchema,
      execute: async (args: z.infer<typeof TransactionalEmailSchema>) =>
        client.sendTransactionalEmail(args),
    },
  };
}

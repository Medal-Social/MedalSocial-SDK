import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Medal } from "../src/index.js";
import { createMedalTools } from "./index.js";

const mockClient = {
  emails: {
    send: vi.fn().mockResolvedValue({ data: { id: "email_1", status: "queued" } }),
  },
  contacts: {
    create: vi.fn().mockResolvedValue({ data: { id: "contact_1" } }),
    addNote: vi.fn().mockResolvedValue({ data: { id: "note_1" } }),
  },
  deals: {
    create: vi.fn().mockResolvedValue({ data: { id: "deal_1" } }),
  },
  gdpr: {
    recordConsent: vi.fn().mockResolvedValue({ data: { id: "consent_1" } }),
    cookieConsent: vi.fn().mockResolvedValue({ success: true }),
  },
} as unknown as Medal;

describe("createMedalTools", () => {
  it("returns an object with all 6 tools", () => {
    const tools = createMedalTools(mockClient);
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools).toHaveProperty("sendEmail");
    expect(tools).toHaveProperty("createContact");
    expect(tools).toHaveProperty("addContactNote");
    expect(tools).toHaveProperty("recordCookieConsent");
    expect(tools).toHaveProperty("recordConsent");
    expect(tools).toHaveProperty("createDeal");
  });

  it("each tool has description, parameters (ZodSchema), and execute", () => {
    const tools = createMedalTools(mockClient);
    for (const [, tool] of Object.entries(tools)) {
      expect(tool).toHaveProperty("description");
      expect(typeof tool.description).toBe("string");
      expect(tool).toHaveProperty("parameters");
      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
      expect(tool).toHaveProperty("execute");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("sendEmail calls client.emails.send", async () => {
    const tools = createMedalTools(mockClient);
    await tools.sendEmail.execute({ template_slug: "welcome", to: "a@b.com" });
    expect(mockClient.emails.send).toHaveBeenCalledWith({
      template_slug: "welcome",
      to: "a@b.com",
    });
  });

  it("createContact calls client.contacts.create", async () => {
    const tools = createMedalTools(mockClient);
    await tools.createContact.execute({ email: "alice@example.com", first_name: "Alice" });
    expect(mockClient.contacts.create).toHaveBeenCalledWith({
      email: "alice@example.com",
      first_name: "Alice",
    });
  });

  it("addContactNote calls client.contacts.addNote with split args", async () => {
    const tools = createMedalTools(mockClient);
    await tools.addContactNote.execute({ contactId: "c_123", content: "Followed up" });
    expect(mockClient.contacts.addNote).toHaveBeenCalledWith("c_123", { content: "Followed up" });
  });

  it("createDeal calls client.deals.create", async () => {
    const tools = createMedalTools(mockClient);
    await tools.createDeal.execute({ title: "Acme Partnership", value: 50000 });
    expect(mockClient.deals.create).toHaveBeenCalledWith({
      title: "Acme Partnership",
      value: 50000,
    });
  });
});

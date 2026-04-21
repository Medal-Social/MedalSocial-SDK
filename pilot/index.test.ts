import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MedalSocialClient } from "../src/index.js";
import { createMedalTools } from "./index.js";

const mockClient = {
  createLead: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
  createContactNote: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
  createCookieConsent: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
  createEventSignup: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
  createNote: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
  sendTransactionalEmail: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
} as unknown as MedalSocialClient;

describe("createMedalTools", () => {
  it("returns an object with all 6 tools", () => {
    const tools = createMedalTools(mockClient);
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools).toHaveProperty("createLead");
    expect(tools).toHaveProperty("createContactNote");
    expect(tools).toHaveProperty("createCookieConsent");
    expect(tools).toHaveProperty("createEventSignup");
    expect(tools).toHaveProperty("createNote");
    expect(tools).toHaveProperty("sendTransactionalEmail");
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

  it("createLead tool calls client.createLead with parsed args", async () => {
    const tools = createMedalTools(mockClient);
    await tools.createLead.execute({ items: [{ name: "Alice", email: "alice@example.com" }] });
    expect(mockClient.createLead).toHaveBeenCalledWith([
      { name: "Alice", email: "alice@example.com" },
    ]);
  });

  it("sendTransactionalEmail tool calls client.sendTransactionalEmail", async () => {
    const tools = createMedalTools(mockClient);
    await tools.sendTransactionalEmail.execute({ to: "a@b.com", slug: "welcome" });
    expect(mockClient.sendTransactionalEmail).toHaveBeenCalledWith({
      to: "a@b.com",
      slug: "welcome",
    });
  });
});

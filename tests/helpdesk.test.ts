import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Created",
    headers: { "content-type": "application/json" },
  });
}

describe("helpdesk conversations", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists conversations without filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/helpdesk/conversations");
      expect([...parsed.searchParams.keys()]).toHaveLength(0);
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.helpdesk.conversations.list();
    expect(result.pagination.has_more).toBe(false);
  });

  it("lists conversations with all filters (channels as CSV)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("status")).toBe("open");
      expect(parsed.searchParams.get("assignee_user_id")).toBe("user_1");
      expect(parsed.searchParams.get("requester")).toBe("visitor@example.com");
      expect(parsed.searchParams.get("query")).toBe("refund");
      expect(parsed.searchParams.get("channels")).toBe("widget,whatsapp");
      expect(parsed.searchParams.get("limit")).toBe("25");
      expect(parsed.searchParams.get("cursor")).toBe("cur_1");
      return mockJson({
        data: [{ id: "conv_1", channel: "widget", status: "open" }],
        pagination: { has_more: true, next_cursor: "cur_2" },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.helpdesk.conversations.list({
      status: "open",
      assignee_user_id: "user_1",
      requester: "visitor@example.com",
      query: "refund",
      channels: ["widget", "whatsapp"],
      limit: 25,
      cursor: "cur_1",
    });
    expect(result.data[0].id).toBe("conv_1");
    expect(result.pagination.next_cursor).toBe("cur_2");
  });

  it("gets a conversation by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/helpdesk/conversations/conv_1");
      return mockJson({
        data: {
          id: "conv_1",
          channel: "widget",
          status: "open",
          message_count: 3,
          unread_for_operator: 1,
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.helpdesk.conversations.get("conv_1");
    expect(data.id).toBe("conv_1");
    expect(data.message_count).toBe(3);
  });

  it("updates status and assignee via PATCH", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/helpdesk/conversations/conv_1");
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse(init?.body as string);
      expect(body.status).toBe("closed");
      expect(body.assignee_user_id).toBe(null);
      return mockJson({ data: { id: "conv_1", status: "closed", assignee_user_id: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.helpdesk.conversations.update("conv_1", {
      status: "closed",
      assignee_user_id: null,
    });
    expect(data.status).toBe("closed");
    expect(data.assignee_user_id).toBe(null);
  });

  it("sends an Idempotency-Key header on update when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("idem_update_1");
      return mockJson({ data: { id: "conv_1", status: "open", assignee_user_id: "user_1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.helpdesk.conversations.update(
      "conv_1",
      { assignee_user_id: "user_1" },
      { idempotencyKey: "idem_update_1" },
    );
  });

  it("reads messages without pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/helpdesk/conversations/conv_1/messages");
      expect([...parsed.searchParams.keys()]).toHaveLength(0);
      return mockJson({
        data: [
          {
            id: "msg_1",
            conversation_id: "conv_1",
            author_type: "visitor",
            message_type: "chat",
            body: "Hi!",
          },
        ],
        pagination: { has_more: false, next_cursor: null },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.helpdesk.conversations.messages("conv_1");
    expect(result.data[0].author_type).toBe("visitor");
  });

  it("reads messages with pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("50");
      expect(parsed.searchParams.get("cursor")).toBe("cur_m1");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.helpdesk.conversations.messages("conv_1", { limit: 50, cursor: "cur_m1" });
  });

  it("deserializes outbound delivery state on messages", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({
        data: [
          {
            id: "msg_out",
            conversation_id: "conv_1",
            author_type: "operator",
            message_type: "chat",
            author_user_id: "u_1",
            author_name: "Ada",
            body: "On it",
            delivery_status: "failed",
            delivery_error: "channel rejected message",
            created_at: 1755100000000,
          },
          {
            id: "msg_in",
            conversation_id: "conv_1",
            author_type: "visitor",
            message_type: "chat",
            author_user_id: null,
            author_name: null,
            body: "Help",
            delivery_status: null,
            delivery_error: null,
            created_at: 1755100000001,
          },
        ],
        pagination: { has_more: false, next_cursor: null },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.helpdesk.conversations.messages("conv_1");
    expect(data[0].delivery_status).toBe("failed");
    expect(data[0].delivery_error).toBe("channel rejected message");
    expect(data[1].delivery_status).toBeNull();
    expect(data[1].delivery_error).toBeNull();
  });

  it("encodes conversation IDs in paths", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/helpdesk/conversations/conv%2F1");
      return mockJson({ data: { id: "conv/1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.helpdesk.conversations.get("conv/1");
  });
});

describe("helpdesk replies", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a reply with an Idempotency-Key header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/helpdesk/replies");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("idem_reply_1");
      const body = JSON.parse(init?.body as string);
      expect(body.conversation_id).toBe("conv_1");
      expect(body.body).toBe("Thanks for reaching out!");
      expect(body.author_name).toBe("Support Bot");
      return mockJson({ data: { id: "msg_2", conversation_id: "conv_1", status: "created" } }, 201);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.helpdesk.replies.create(
      {
        conversation_id: "conv_1",
        body: "Thanks for reaching out!",
        author_name: "Support Bot",
      },
      { idempotencyKey: "idem_reply_1" },
    );
    expect(data.id).toBe("msg_2");
    expect(data.status).toBe("created");
  });

  it("keys an internal note the caller left unkeyed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      // A note duplicates on retry exactly like a customer-facing reply does,
      // so it gets a generated key rather than going out bare.
      expect(headers.get("idempotency-key")).toBeTruthy();
      const body = JSON.parse(init?.body as string);
      expect(body.message_type).toBe("note");
      return mockJson({ data: { id: "msg_3", conversation_id: "conv_1", status: "created" } }, 201);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.helpdesk.replies.create({
      conversation_id: "conv_1",
      body: "Internal context for the team",
      message_type: "note",
    });
    expect(data.id).toBe("msg_3");
  });
});

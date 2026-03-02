import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal, MedalApiError } from "../src";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

describe("Medal constructor", () => {
  it("throws when token is empty", () => {
    expect(() => new Medal("")).toThrow("Authentication token is required");
  });

  it("creates all resource namespaces", () => {
    const medal = new Medal("medal_test", { baseUrl: BASE });
    expect(medal.emails).toBeDefined();
    expect(medal.contacts).toBeDefined();
    expect(medal.deals).toBeDefined();
    expect(medal.gdpr).toBeDefined();
    expect(medal.posts).toBeDefined();
    expect(medal.workspaces).toBeDefined();
  });

  it("uses default baseUrl and timeout when no options provided", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("https://io.medalsocial.com/api/v1/me/workspaces");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test");
    await medal.workspaces.list();
    vi.restoreAllMocks();
  });

  it("strips trailing slash from baseUrl", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("https://custom.example.com/api/v1/me/workspaces");
      expect(url).not.toContain("//api");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: "https://custom.example.com/" });
    await medal.workspaces.list();
    vi.restoreAllMocks();
  });
});

describe("authentication", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends Bearer token header with API key", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      expect(headers.get("x-workspace-id")).toBeNull();
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list();
  });

  it("sends Bearer token and X-Workspace-Id header with OAuth token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer oauth_access_token_xyz");
      expect(headers.get("x-workspace-id")).toBe("ws_123");
      return mockJson({ data: [] });
    });
    const medal = new Medal("oauth_access_token_xyz", {
      baseUrl: BASE,
      workspaceId: "ws_123",
    });
    await medal.contacts.list();
  });
});

describe("error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws MedalApiError on 4xx with structured error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ error: { code: "NOT_FOUND", message: "Contact not found" } }, 404),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    try {
      await medal.contacts.get("bad_id");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MedalApiError);
      const apiErr = err as MedalApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.code).toBe("NOT_FOUND");
      expect(apiErr.message).toBe("Contact not found");
    }
  });

  it("handles non-JSON error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 502, statusText: "Bad Gateway" }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.contacts.list()).rejects.toBeInstanceOf(MedalApiError);
  });
});

describe("retries", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("retries on 429 then succeeds", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }));
    spy.mockResolvedValueOnce(mockJson({ data: [] }));
    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    const result = await medal.contacts.list();
    expect(result.data).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 with linear backoff", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("", { status: 500 }));
    spy.mockResolvedValueOnce(mockJson({ data: { id: "d1" } }));
    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    const result = await medal.deals.get("d1");
    expect(result.data.id).toBe("d1");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retry attempts on persistent 500", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValue(new Response("", { status: 500 }));
    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    await expect(medal.contacts.list()).rejects.toBeInstanceOf(MedalApiError);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retry attempts on persistent 429", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "0" } }));
    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    await expect(medal.contacts.list()).rejects.toBeInstanceOf(MedalApiError);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("uses Retry-After header with non-numeric value gracefully", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "invalid" } }),
    );
    spy.mockResolvedValueOnce(mockJson({ data: [] }));
    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    const result = await medal.contacts.list();
    expect(result.data).toEqual([]);
  });
});

describe("emails", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends an email via POST /api/v1/emails", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/emails");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.template_slug).toBe("welcome");
      expect(body.to).toBe("user@example.com");
      return mockJson({ data: { id: "es_1", status: "queued" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.send({
      template_slug: "welcome",
      to: "user@example.com",
      variables: { name: "John" },
    });
    expect(data.id).toBe("es_1");
    expect(data.status).toBe("queued");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends email with locale options", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.locale).toBe("ar");
      expect(body.fallback_locale).toBe("en");
      expect(body.contact_id).toBe("c_123");
      return mockJson({ data: { id: "es_2", status: "queued" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.send({
      template_slug: "welcome",
      to: "user@example.com",
      locale: "ar",
      fallback_locale: "en",
      contact_id: "c_123",
    });
    expect(data.id).toBe("es_2");
  });

  it("gets email status via GET /api/v1/emails/{id}", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { id: "es_1", status: "delivered", recipient_email: "user@example.com" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.get("es_1");
    expect(data.status).toBe("delivered");
  });

  it("batch sends emails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.recipients).toHaveLength(2);
      return mockJson({
        data: [
          { email: "a@test.com", id: "es_1", status: "queued" },
          { email: "b@test.com", id: "es_2", status: "queued" },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.batch({
      template_slug: "newsletter",
      recipients: [
        { email: "a@test.com", name: "Alice" },
        { email: "b@test.com", name: "Bob" },
      ],
    });
    expect(data).toHaveLength(2);
  });

  it("lists templates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: [{ id: "t1", name: "Welcome", slug: "welcome" }] }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.templates.list();
    expect(data[0].slug).toBe("welcome");
  });

  it("gets a template by slug with locale options", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("locale")).toBe("ar");
      return mockJson({
        data: { id: "t1", name: "Welcome", slug: "welcome", resolved_locale: "ar" },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.templates.get("welcome", { locale: "ar" });
    expect(data.name).toBe("Welcome");
  });

  it("gets a template with fallback_locale", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("fallback_locale")).toBe("en");
      return mockJson({ data: { id: "t1", name: "Welcome", slug: "welcome" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.emails.templates.get("welcome", { fallback_locale: "en" });
  });
});

describe("contacts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists contacts with filters", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("status")).toBe("lead");
      expect(parsed.searchParams.get("limit")).toBe("10");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.contacts.list({ status: "lead", limit: 10 });
    expect(result.pagination.has_more).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("creates a contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.email).toBe("john@example.com");
      expect(body.first_name).toBe("John");
      return mockJson({ data: { id: "c1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.create({
      email: "john@example.com",
      first_name: "John",
    });
    expect(data.id).toBe("c1");
  });

  it("gets a contact by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { id: "c1", email: "john@example.com" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.get("c1");
    expect(data.id).toBe("c1");
  });

  it("updates a contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse(init?.body as string);
      expect(body.company).toBe("New Corp");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.update("c1", { company: "New Corp" });
    expect(data.success).toBe(true);
  });

  it("deletes a contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.remove("c1");
    expect(data.success).toBe(true);
  });

  it("gets contact activities", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: [{ id: "a1", type: "note.added", title: "Note" }],
        pagination: { has_more: false, next_cursor: null },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.contacts.activities("c1");
    expect(result.data[0].type).toBe("note.added");
  });

  it("adds a note to a contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.content).toBe("Follow up next week");
      return mockJson({ data: { id: "a1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.addNote("c1", { content: "Follow up next week" });
    expect(data.id).toBe("a1");
  });

  it("bulk imports contacts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.contacts).toHaveLength(2);
      return mockJson({ data: { added: 2, skipped: 0, total: 2 } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.import([
      { email: "a@test.com", first_name: "Alice" },
      { email: "b@test.com", first_name: "Bob" },
    ]);
    expect(data.added).toBe(2);
  });

  it("passes label_ids as comma-separated string", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("label_ids")).toBe("lbl_1,lbl_2");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list({ label_ids: ["lbl_1", "lbl_2"] });
  });

  it("passes email_status and search filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("email_status")).toBe("subscribed");
      expect(parsed.searchParams.get("search")).toBe("john");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list({ email_status: "subscribed", search: "john" });
  });

  it("passes pagination to activities", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("20");
      expect(parsed.searchParams.get("cursor")).toBe("cur_abc");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.activities("c1", { limit: 20, cursor: "cur_abc" });
  });
});

describe("deals", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists deals with filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("status")).toBe("open");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.list({ status: "open" });
  });

  it("lists deals with search", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("search")).toBe("Acme");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.list({ search: "Acme" });
  });

  it("lists deals with pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("25");
      expect(parsed.searchParams.get("cursor")).toBe("cur_xyz");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.list({ limit: 25, cursor: "cur_xyz" });
  });

  it("creates a deal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.title).toBe("Acme Deal");
      expect(body.value).toBe(50000);
      return mockJson({ data: { id: "d1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.create({ title: "Acme Deal", value: 50000 });
    expect(data.id).toBe("d1");
  });

  it("gets a deal by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { id: "d1", title: "Acme Deal" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.get("d1");
    expect(data.id).toBe("d1");
  });

  it("updates a deal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("PATCH");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.update("d1", { status: "won" });
    expect(data.success).toBe(true);
  });

  it("deletes a deal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.remove("d1");
    expect(data.success).toBe(true);
  });
});

describe("posts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists posts with filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("status")).toBe("draft");
      expect(parsed.searchParams.get("type")).toBe("social");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.posts.list({ status: "draft", type: "social" });
    expect(result.pagination.has_more).toBe(false);
  });

  it("lists posts with pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("10");
      expect(parsed.searchParams.get("cursor")).toBe("cur_p1");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.posts.list({ limit: 10, cursor: "cur_p1" });
  });

  it("creates a post", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.content).toBe("Hello world!");
      expect(body.channel_ids).toEqual(["ch_1", "ch_2"]);
      return mockJson({ data: { id: "p1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.create({
      content: "Hello world!",
      channel_ids: ["ch_1", "ch_2"],
    });
    expect(data.id).toBe("p1");
  });

  it("gets a post with variants", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: {
          id: "p1",
          content: "Hello",
          status: "published",
          variants: [
            { id: "v1", channel_id: "ch_1", status: "published", permalink: "https://x.com/..." },
          ],
        },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.get("p1");
    expect(data.variants).toHaveLength(1);
    expect(data.variants[0].permalink).toBeTruthy();
  });

  it("updates a draft post", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse(init?.body as string);
      expect(body.content).toBe("Updated content");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.update("p1", { content: "Updated content" });
    expect(data.success).toBe(true);
  });

  it("deletes a post", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { success: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.remove("p1");
    expect(data.success).toBe(true);
  });

  it("schedules a post with ISO datetime", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/posts/p1/schedule");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.scheduled_at).toBe("2026-03-15T10:00:00Z");
      return mockJson({ data: { success: true, workflow_id: "wf_1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.schedule("p1", { scheduled_at: "2026-03-15T10:00:00Z" });
    expect(data.success).toBe(true);
    expect(data.workflow_id).toBe("wf_1");
  });

  it("schedules a post with Unix timestamp", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.scheduled_at).toBe(1773756000000);
      return mockJson({ data: { success: true, workflow_id: "wf_2" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.schedule("p1", { scheduled_at: 1773756000000 });
    expect(data.workflow_id).toBe("wf_2");
  });

  it("publishes a post immediately", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/posts/p1/publish");
      expect(init?.method).toBe("POST");
      return mockJson({ data: { success: true, workflow_id: "wf_3" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.publish("p1");
    expect(data.success).toBe(true);
  });

  it("lists connected channels", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/posts/channels");
      return mockJson({
        data: [
          { id: "ch_1", platform: "twitter", display_name: "@acme", state: "active" },
          { id: "ch_2", platform: "linkedin", display_name: "Acme Inc", state: "active" },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.posts.channels();
    expect(data).toHaveLength(2);
    expect(data[0].platform).toBe("twitter");
  });
});

describe("workspaces", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists workspaces via GET /api/v1/me/workspaces", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/me/workspaces");
      return mockJson({
        data: [{ id: "ws_1", name: "My Workspace", slug: "my-workspace" }],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.workspaces.list();
    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe("my-workspace");
  });
});

describe("gdpr", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requests a workspace export", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("POST");
      return mockJson({ data: { request_id: "exp_1", status: "pending" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.requestExport();
    expect(data.request_id).toBe("exp_1");
  });

  it("lists exports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: [
          {
            id: "exp_1",
            request_type: "workspace_export",
            status: "completed",
            submitted_at: "2026-03-01T10:00:00.000Z",
            completed_at: "2026-03-01T10:05:00.000Z",
            due_date: "2026-03-31T10:00:00.000Z",
          },
        ],
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.listExports();
    expect(data[0].status).toBe("completed");
    expect(data[0].submitted_at).toBe("2026-03-01T10:00:00.000Z");
    expect(data[0].due_date).toBe("2026-03-31T10:00:00.000Z");
  });

  it("gets export status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: {
          id: "exp_1",
          request_type: "workspace_export",
          status: "completed",
          submitted_at: "2026-03-01T10:00:00.000Z",
          completed_at: "2026-03-01T10:05:00.000Z",
          download_url: "https://storage.example.com/file",
          expires_at: "2026-04-01T10:00:00.000Z",
        },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.getExport("exp_1");
    expect(data.download_url).toBeTruthy();
    expect(data.expires_at).toBe("2026-04-01T10:00:00.000Z");
  });

  it("records consent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.email).toBe("user@example.com");
      expect(body.consent_type).toBe("marketing_email");
      expect(body.granted).toBe(true);
      return mockJson({
        data: {
          id: "cc_1",
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.recordConsent({
      email: "user@example.com",
      consent_type: "marketing_email",
      granted: true,
    });
    expect(data.id).toBe("cc_1");
  });

  it("gets consent by email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: [
          { id: "cc_1", email: "user@example.com", consent_type: "marketing_email", granted: true },
        ],
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.getConsent("user@example.com");
    expect(data).toHaveLength(1);
  });

  it("sends cookie consent to legacy endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/cookie-consent");
      const body = JSON.parse(init?.body as string);
      expect(body.domain).toBe("example.com");
      return mockJson({ success: true, logId: "log_1" });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.gdpr.cookieConsent({
      domain: "example.com",
      consentStatus: "granted",
      consentTimestamp: "2025-06-04T10:30:00Z",
      cookiePreferences: {
        necessary: { allowed: true },
        analytics: { allowed: true },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("misc", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ignores user-agent set errors gracefully", async () => {
    const OriginalHeaders = globalThis.Headers;
    class ThrowHeaders extends OriginalHeaders {
      set(name: string, value: string) {
        if (name.toLowerCase() === "user-agent") {
          throw new Error("blocked");
        }
        return super.set(name, value);
      }
    }
    // @ts-expect-error override for test
    globalThis.Headers = ThrowHeaders;

    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJson({ data: [] }));
      const medal = new Medal("medal_test", { baseUrl: BASE });
      const result = await medal.contacts.list();
      expect(result.data).toEqual([]);
    } finally {
      // @ts-expect-error restore
      globalThis.Headers = OriginalHeaders;
    }
  });

  it("passes query params for pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("25");
      expect(parsed.searchParams.get("cursor")).toBe("abc123");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list({ limit: 25, cursor: "abc123" });
  });

  it("encodes path parameters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/gdpr/consent/user%40example.com");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.gdpr.getConsent("user@example.com");
  });
});

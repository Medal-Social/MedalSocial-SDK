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
  it("throws when API key is empty", () => {
    expect(() => new Medal("")).toThrow("API key is required");
  });

  it("creates resource namespaces", () => {
    const medal = new Medal("medal_test", { baseUrl: BASE });
    expect(medal.emails).toBeDefined();
    expect(medal.contacts).toBeDefined();
    expect(medal.deals).toBeDefined();
    expect(medal.gdpr).toBeDefined();
  });
});

describe("authentication", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends Bearer token header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
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
    spy.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "0" } }),
    );
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

  it("gets email status via GET /api/v1/emails/{id}", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { id: "es_1", status: "delivered", to: "user@example.com" } }),
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

  it("gets a template by slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { id: "t1", name: "Welcome", slug: "welcome" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.emails.templates.get("welcome");
    expect(data.name).toBe("Welcome");
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
      return mockJson({ data: { id: "c1", email: "john@example.com", first_name: "John" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.create({
      email: "john@example.com",
      first_name: "John",
    });
    expect(data.email).toBe("john@example.com");
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
      return mockJson({ data: { id: "c1", company: "New Corp" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.update("c1", { company: "New Corp" });
    expect(data.company).toBe("New Corp");
  });

  it("deletes a contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { deleted: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.remove("c1");
    expect(data.deleted).toBe(true);
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
      return mockJson({ data: { activity_id: "a1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.addNote("c1", { content: "Follow up next week" });
    expect(data.activity_id).toBe("a1");
  });

  it("bulk imports contacts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.contacts).toHaveLength(2);
      return mockJson({ data: { imported: 2, skipped: 0, total: 2 } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.contacts.import([
      { email: "a@test.com", first_name: "Alice" },
      { email: "b@test.com", first_name: "Bob" },
    ]);
    expect(data.imported).toBe(2);
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

  it("creates a deal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.title).toBe("Acme Deal");
      expect(body.value).toBe(50000);
      return mockJson({ data: { id: "d1", title: "Acme Deal", value: 50000 } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.create({ title: "Acme Deal", value: 50000 });
    expect(data.title).toBe("Acme Deal");
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
      return mockJson({ data: { id: "d1", status: "won" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.update("d1", { status: "won" });
    expect(data.status).toBe("won");
  });

  it("deletes a deal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { deleted: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.deals.remove("d1");
    expect(data.deleted).toBe(true);
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
      mockJson({ data: [{ id: "exp_1", status: "completed" }] }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.listExports();
    expect(data[0].status).toBe("completed");
  });

  it("gets export status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: { id: "exp_1", status: "completed", download_url: "https://storage.example.com/file" },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.getExport("exp_1");
    expect(data.download_url).toBeTruthy();
  });

  it("records consent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.email).toBe("user@example.com");
      expect(body.consent_type).toBe("marketing_email");
      expect(body.granted).toBe(true);
      return mockJson({
        data: {
          consent_id: "cc_1",
          email: "user@example.com",
          consent_type: "marketing_email",
          granted: true,
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.recordConsent({
      email: "user@example.com",
      consent_type: "marketing_email",
      granted: true,
    });
    expect(data.consent_id).toBe("cc_1");
  });

  it("gets consent by email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({
        data: {
          email: "user@example.com",
          consents: [{ id: "cc_1", consent_type: "marketing_email", granted: true }],
        },
      }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.gdpr.getConsent("user@example.com");
    expect(data.consents).toHaveLength(1);
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

  it("passes tags as comma-separated string", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("tags")).toBe("vip,premium");
      return mockJson({ data: [], pagination: { has_more: false, next_cursor: null } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list({ tags: ["vip", "premium"] });
  });

  it("encodes path parameters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/gdpr/consent/user%40example.com");
      return mockJson({ data: { email: "user@example.com", consents: [] } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.gdpr.getConsent("user@example.com");
  });
});

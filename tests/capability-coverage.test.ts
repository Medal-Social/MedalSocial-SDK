import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseClient,
  CAPABILITY_IDS,
  CAPABILITY_ROUTES,
  Contacts,
  Deals,
  Emails,
  Gdpr,
  Medal,
  Posts,
} from "../src";

const BASE = "https://test.example.com";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}

/**
 * A client with auto-confirmation on, plus a fetch mock that answers the
 * confirmation mint and then the write. Returns the two recorded requests.
 */
function recordingClient() {
  const calls: { method: string; path: string; body: unknown; headers: Headers }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const parsed = new URL(url as string);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({
      method: init?.method ?? "GET",
      path: parsed.pathname,
      body,
      headers: new Headers(init?.headers),
    });
    if (parsed.pathname === "/api/v1/capability-confirmations") {
      return mockJson({
        data: {
          confirmation_token: "mcct_token_1",
          token_type: "medal_capability_confirmation",
          capability_id: body.capability_id,
          method: "POST",
          path: "/x",
          required_scopes: [],
          idempotency_key: body.idempotency_key ?? null,
          expires_in: 900,
          expires_at: "2026-09-11T12:00:00.000Z",
          preview_summary: body.preview_summary,
        },
      });
    }
    return mockJson({ data: { ok: true } });
  });

  const medal = new Medal("medal_test", {
    baseUrl: BASE,
    autoConfirmCapabilities: { previewSummary: (ctx) => `approved ${ctx.method} ${ctx.path}` },
  });
  return { medal, calls };
}

describe("capability registry mirrors the server registry (SDK-4)", () => {
  it("lists every confirmable API capability the server registers", () => {
    expect([...CAPABILITY_IDS].sort()).toEqual(
      [
        "ai.text.generate",
        "channel.connect_link.create.execute",
        "channel.connect_link.revoke.execute",
        "channel.connection.disconnect.execute",
        "channel.telegram_sync_config.update.execute",
        "compliance.gdpr.export.execute",
        "content.post.draft.create",
        "content.post.media.attach.execute",
        "content.post.publish.execute",
        "content.post.schedule.execute",
        "crm.contact.note.create.execute",
        "deals.deal.create.execute",
        "deals.deal.update.execute",
        "email.campaign.send.execute",
        "email.draft.create.execute",
        "flows.enrollment.create.execute",
        "helpdesk.conversation.link_contact.execute",
        "helpdesk.conversation.reply.execute",
        "helpdesk.conversation.unlink_contact.execute",
        "helpdesk.conversation.update.execute",
        "helpdesk.webhook.create.execute",
        "helpdesk.webhook.delete.execute",
        "helpdesk.webhook.update.execute",
        "image.generation.execute",
        "media.generated_asset.save.execute",
        "site.sanity.document.create.execute",
        "site.sanity.document.update.execute",
      ].sort(),
    );
  });

  it("maps the newly covered capabilities to their method + path template", () => {
    expect(CAPABILITY_ROUTES["deals.deal.update.execute"]).toMatchObject({
      method: "PATCH",
      path_template: "/api/v1/deals/{id}",
    });
    expect(CAPABILITY_ROUTES["crm.contact.note.create.execute"]).toMatchObject({
      method: "POST",
      path_template: "/api/v1/contacts/{id}/notes",
    });
    expect(CAPABILITY_ROUTES["content.post.publish.execute"]).toMatchObject({
      method: "POST",
      path_template: "/api/v1/posts/{id}/publish",
    });
    expect(CAPABILITY_ROUTES["helpdesk.conversation.link_contact.execute"]).toMatchObject({
      method: "PUT",
      path_template: "/api/v1/helpdesk/conversations/{id}/contact",
    });
  });

  it("names the alternate targets of the two capabilities that have several", () => {
    // The server requires an explicit `api_path` when a capability maps to more
    // than one API route, so the SDK has to know they are ambiguous.
    expect(CAPABILITY_ROUTES["email.campaign.send.execute"].alternate_path_templates).toEqual([
      "/api/v1/emails/batch",
    ]);
    expect(CAPABILITY_ROUTES["ai.text.generate"].alternate_path_templates).toEqual([
      "/api/v1/pilot/ask",
    ]);
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITY_ROUTES[id]).toBeDefined();
    }
  });
});

describe("confirmable writes mint a confirmation (SDK-4)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deals.update", async () => {
    const { medal, calls } = recordingClient();
    await medal.deals.update("d1", { status: "signed" });
    expect(calls[0].path).toBe("/api/v1/capability-confirmations");
    expect(calls[0].body).toMatchObject({
      capability_id: "deals.deal.update.execute",
      path_params: { id: "d1" },
      user_approved: true,
    });
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
    expect(calls[1].headers.get("idempotency-key")).toBe(
      (calls[0].body as { idempotency_key: string }).idempotency_key,
    );
  });

  it("deals.create", async () => {
    const { medal, calls } = recordingClient();
    await medal.deals.create({ title: "Acme" });
    expect(calls[0].body).toMatchObject({ capability_id: "deals.deal.create.execute" });
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("contacts.addNote", async () => {
    const { medal, calls } = recordingClient();
    await medal.contacts.addNote("c1", { content: "hei" });
    expect(calls[0].body).toMatchObject({
      capability_id: "crm.contact.note.create.execute",
      path_params: { id: "c1" },
    });
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("posts.create", async () => {
    const { medal, calls } = recordingClient();
    await medal.posts.create({ content: "hello", channel_ids: ["ch_1"] });
    expect(calls[0].body).toMatchObject({ capability_id: "content.post.draft.create" });
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("posts.schedule", async () => {
    const { medal, calls } = recordingClient();
    await medal.posts.schedule("p1", { scheduled_at: "2026-10-01T10:00:00Z" });
    expect(calls[0].body).toMatchObject({
      capability_id: "content.post.schedule.execute",
      path_params: { id: "p1" },
    });
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("posts.publish", async () => {
    const { medal, calls } = recordingClient();
    await medal.posts.publish("p1");
    expect(calls[0].body).toMatchObject({
      capability_id: "content.post.publish.execute",
      path_params: { id: "p1" },
    });
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("emails.send binds the /api/v1/emails target explicitly", async () => {
    const { medal, calls } = recordingClient();
    await medal.emails.send({ template_slug: "welcome", to: "a@b.co" });
    expect(calls[0].body).toMatchObject({
      capability_id: "email.campaign.send.execute",
      api_path: "/api/v1/emails",
    });
    expect(calls[1].path).toBe("/api/v1/emails");
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("emails.batch binds the /api/v1/emails/batch target explicitly", async () => {
    const { medal, calls } = recordingClient();
    await medal.emails.batch({ template_slug: "welcome", recipients: [{ email: "a@b.co" }] });
    expect(calls[0].body).toMatchObject({
      capability_id: "email.campaign.send.execute",
      api_path: "/api/v1/emails/batch",
    });
    expect(calls[1].path).toBe("/api/v1/emails/batch");
  });

  it("gdpr.requestExport", async () => {
    const { medal, calls } = recordingClient();
    await medal.gdpr.requestExport();
    expect(calls[0].body).toMatchObject({ capability_id: "compliance.gdpr.export.execute" });
    expect(calls[1].path).toBe("/api/v1/gdpr/export");
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("helpdesk.conversations.linkContact sends a PUT with both headers", async () => {
    const { medal, calls } = recordingClient();
    await medal.helpdesk.conversations.linkContact("cv1", { email: "ida@example.no" });
    expect(calls[0].body).toMatchObject({
      capability_id: "helpdesk.conversation.link_contact.execute",
      path_params: { id: "cv1" },
    });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].path).toBe("/api/v1/helpdesk/conversations/cv1/contact");
    expect(calls[1].headers.get("x-capability-confirmation")).toBe("mcct_token_1");
  });

  it("helpdesk.conversations.unlinkContact sends a DELETE with both headers", async () => {
    const { medal, calls } = recordingClient();
    await medal.helpdesk.conversations.unlinkContact("cv1");
    expect(calls[0].body).toMatchObject({
      capability_id: "helpdesk.conversation.unlink_contact.execute",
      path_params: { id: "cv1" },
    });
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].path).toBe("/api/v1/helpdesk/conversations/cv1/contact");
  });

  it("does not mint anything when auto-confirm is off", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(new URL(url as string).pathname);
      return mockJson({ data: { ok: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.update("d1", { status: "signed" });
    expect(calls).toEqual(["/api/v1/deals/d1"]);
  });
});

describe("resources built directly, without a shared confirmer (SDK-4)", () => {
  beforeEach(() => vi.restoreAllMocks());

  function bareClient() {
    return new BaseClient({
      baseUrl: BASE,
      token: "medal_test",
      timeout: 5000,
      userAgent: "test-agent",
    });
  }

  const constructed: [string, (client: BaseClient) => Promise<unknown>, string][] = [
    [
      "Contacts",
      (c) => new Contacts(c).addNote("c1", { content: "x" }),
      "/api/v1/contacts/c1/notes",
    ],
    ["Deals", (c) => new Deals(c).create({ title: "Acme" }), "/api/v1/deals"],
    ["Posts", (c) => new Posts(c).publish("p1"), "/api/v1/posts/p1/publish"],
    ["Emails", (c) => new Emails(c).send({ template_slug: "w", to: "a@b.co" }), "/api/v1/emails"],
    ["Gdpr", (c) => new Gdpr(c).requestExport(), "/api/v1/gdpr/export"],
  ];

  // A resource constructed by hand has no client-level auto-confirm default, so
  // the write goes straight out with no mint — the documented behaviour of the
  // `confirmer ?? new CapabilityConfirmer(...)` fallback.
  it.each(constructed)("%s mints nothing on its own", async (_name, call, path) => {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      paths.push(new URL(url as string).pathname);
      return mockJson({ data: { ok: true } });
    });
    await call(bareClient());
    expect(paths).toEqual([path]);
  });
});

describe("delete aliases (SDK-19)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const aliases: [string, (medal: Medal) => Promise<unknown>, string][] = [
    ["contacts.delete", (m) => m.contacts.delete("c1"), "/api/v1/contacts/c1"],
    ["deals.delete", (m) => m.deals.delete("d1"), "/api/v1/deals/d1"],
    ["posts.delete", (m) => m.posts.delete("p1"), "/api/v1/posts/p1"],
    ["webhooks.remove", (m) => m.webhooks.remove("wh1"), "/api/v1/webhooks/wh1"],
    [
      "channels.connectLinks.delete",
      (m) => m.channels.connectLinks.delete("cl1"),
      "/api/v1/channels/connect-links/cl1",
    ],
    [
      "channels.connections.delete",
      (m) => m.channels.connections.delete("cx1"),
      "/api/v1/channels/connections/cx1",
    ],
  ];

  it.each(aliases)("%s hits the same route as its twin", async (_name, call, path) => {
    const seen: { path: string; method: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      seen.push({ path: new URL(url as string).pathname, method: init?.method ?? "GET" });
      return mockJson({ data: { success: true } });
    });
    await call(new Medal("medal_test", { baseUrl: BASE }));
    expect(seen).toEqual([{ path, method: "DELETE" }]);
  });
});

describe("every write carries RequestOptions (SDK-19)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const writes: [string, (medal: Medal) => Promise<unknown>][] = [
    ["contacts.update", (m) => m.contacts.update("c1", { first_name: "Ida" }, { retry: false })],
    ["contacts.remove", (m) => m.contacts.remove("c1", { retry: false })],
    ["deals.update", (m) => m.deals.update("d1", { title: "x" }, { retry: false })],
    ["deals.remove", (m) => m.deals.remove("d1", { retry: false })],
    ["posts.update", (m) => m.posts.update("p1", { content: "x" }, { retry: false })],
    ["posts.remove", (m) => m.posts.remove("p1", { retry: false })],
    ["posts.schedule", (m) => m.posts.schedule("p1", { scheduled_at: "x" }, { retry: false })],
    ["posts.publish", (m) => m.posts.publish("p1", { retry: false })],
    [
      "gdpr.recordConsent",
      (m) =>
        m.gdpr.recordConsent({ email: "a@b.co" } as never, {
          retry: false,
        }),
    ],
    ["webhooks.test", (m) => m.webhooks.test("wh1", { retry: false })],
  ];

  it.each(writes)("%s forwards options to the transport", async (_name, call) => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValue(new Response("", { status: 503, statusText: "Error" }));
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(call(medal)).rejects.toThrow();
    // `retry: false` reached the client, so the 503 went out exactly once.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

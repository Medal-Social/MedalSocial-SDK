import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseClient,
  CAPABILITY_IDS,
  CAPABILITY_ROUTES,
  Channels,
  Helpdesk,
  Medal,
  Webhooks,
} from "../src";

const BASE = "https://test.example.com";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}

function confirmationPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      confirmation_token: "mcct_token_1",
      token_type: "medal_capability_confirmation",
      capability_id: "channel.connect_link.create.execute",
      method: "POST",
      path: "/api/v1/channels/connect-links",
      required_scopes: ["channel.connect.manage"],
      idempotency_key: "idem_1",
      expires_in: 900,
      expires_at: "2026-08-19T12:00:00.000Z",
      preview_summary: "Mint a connect link",
      ...overrides,
    },
  };
}

describe("capability id registry", () => {
  it("exports every confirmable capability backing an SDK write route", () => {
    expect([...CAPABILITY_IDS].sort()).toEqual(
      [
        "channel.connect_link.create.execute",
        "channel.connect_link.revoke.execute",
        "channel.connection.disconnect.execute",
        "helpdesk.conversation.reply.execute",
        "helpdesk.conversation.update.execute",
        "helpdesk.webhook.create.execute",
        "helpdesk.webhook.delete.execute",
        "helpdesk.webhook.update.execute",
      ].sort(),
    );
  });

  it("maps each capability id to its method + path template", () => {
    expect(CAPABILITY_ROUTES["channel.connect_link.create.execute"]).toEqual({
      method: "POST",
      path_template: "/api/v1/channels/connect-links",
    });
    expect(CAPABILITY_ROUTES["channel.connection.disconnect.execute"]).toEqual({
      method: "DELETE",
      path_template: "/api/v1/channels/connections/{id}",
    });
    expect(CAPABILITY_ROUTES["helpdesk.webhook.update.execute"]).toEqual({
      method: "PATCH",
      path_template: "/api/v1/webhooks/{id}",
    });
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITY_ROUTES[id]).toBeDefined();
    }
  });
});

describe("capabilityConfirmations.create", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts the documented request body and returns the token envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/capability-confirmations");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        capability_id: "channel.connect_link.create.execute",
        idempotency_key: "idem_1",
        preview_summary: "Mint a connect link for Acme",
        user_approved: true,
      });
      return mockJson(confirmationPayload({ preview_summary: "Mint a connect link for Acme" }));
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.capabilityConfirmations.create({
      capability_id: "channel.connect_link.create.execute",
      idempotency_key: "idem_1",
      preview_summary: "Mint a connect link for Acme",
      user_approved: true,
    });

    expect(data.confirmation_token).toBe("mcct_token_1");
    expect(data.token_type).toBe("medal_capability_confirmation");
    expect(data.required_scopes).toEqual(["channel.connect.manage"]);
    expect(data.expires_in).toBe(900);
    expect(data.idempotency_key).toBe("idem_1");
  });

  it("forwards path_params and api_path when supplied", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        capability_id: "channel.connection.disconnect.execute",
        api_path: "/api/v1/channels/connections/conn_1",
        path_params: { id: "conn_1" },
        idempotency_key: "idem_2",
        preview_summary: "Disconnect conn_1",
        user_approved: true,
      });
      return mockJson(
        confirmationPayload({
          capability_id: "channel.connection.disconnect.execute",
          method: "DELETE",
          path: "/api/v1/channels/connections/conn_1",
          idempotency_key: "idem_2",
        }),
      );
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.capabilityConfirmations.create({
      capability_id: "channel.connection.disconnect.execute",
      api_path: "/api/v1/channels/connections/conn_1",
      path_params: { id: "conn_1" },
      idempotency_key: "idem_2",
      preview_summary: "Disconnect conn_1",
      user_approved: true,
    });

    expect(data.method).toBe("DELETE");
    expect(data.path).toBe("/api/v1/channels/connections/conn_1");
  });

  it("surfaces a null idempotency_key when the server issued an unbound token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson(confirmationPayload({ idempotency_key: null })),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.capabilityConfirmations.create({
      capability_id: "channel.connect_link.create.execute",
      preview_summary: "Mint",
      user_approved: true,
    });
    expect(data.idempotency_key).toBeNull();
  });
});

describe("auto-confirm", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is OFF by default — no confirmation request, no headers", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push(new URL(url as string).pathname);
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBeNull();
      expect(headers.get("x-capability-confirmation")).toBeNull();
      return mockJson({ data: { id: "cl_1", url: "https://connect.example.com/l/x" } }, 201);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.channels.connectLinks.create({ channel_type: "telegram_inbox" });

    expect(calls).toEqual(["/api/v1/channels/connect-links"]);
  });

  it("mints an idempotency key + confirmation token when enabled on the client", async () => {
    const seen: { path: string; headers: Headers; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      seen.push({
        path,
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (path === "/api/v1/capability-confirmations") {
        return mockJson(confirmationPayload({ confirmation_token: "mcct_auto" }));
      }
      return mockJson({ data: { id: "cl_1", url: "https://connect.example.com/l/x" } }, 201);
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: {
        previewSummary: (ctx) => `approved:${ctx.capabilityId}:${ctx.path}`,
      },
    });
    await medal.channels.connectLinks.create({ channel_type: "telegram_inbox" });

    expect(seen.map((c) => c.path)).toEqual([
      "/api/v1/capability-confirmations",
      "/api/v1/channels/connect-links",
    ]);

    const confirmBody = seen[0].body as Record<string, unknown>;
    expect(confirmBody.capability_id).toBe("channel.connect_link.create.execute");
    expect(confirmBody.user_approved).toBe(true);
    expect(confirmBody.preview_summary).toBe(
      "approved:channel.connect_link.create.execute:/api/v1/channels/connect-links",
    );
    expect(typeof confirmBody.idempotency_key).toBe("string");

    const writeHeaders = seen[1].headers;
    expect(writeHeaders.get("x-capability-confirmation")).toBe("mcct_auto");
    expect(writeHeaders.get("idempotency-key")).toBe(confirmBody.idempotency_key);
  });

  it("passes path_params for id-bound routes and resolves the preview path", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      if (path === "/api/v1/capability-confirmations") {
        bodies.push(JSON.parse(init?.body as string));
        return mockJson(confirmationPayload({ confirmation_token: "mcct_auto2" }));
      }
      return mockJson({ data: { id: "conn 1", status: "disconnected" } });
    });

    const previews: string[] = [];
    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: {
        previewSummary: (ctx) => {
          previews.push(`${ctx.method} ${ctx.path}`);
          return "operator approved disconnect";
        },
      },
    });
    await medal.channels.connections.disconnect("conn 1");

    expect(bodies[0].path_params).toEqual({ id: "conn 1" });
    expect(bodies[0].capability_id).toBe("channel.connection.disconnect.execute");
    expect(previews).toEqual(["DELETE /api/v1/channels/connections/conn%201"]);
  });

  it("honours a per-call autoConfirm even when the client default is off", async () => {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = new URL(url as string).pathname;
      paths.push(path);
      if (path === "/api/v1/capability-confirmations") {
        return mockJson(confirmationPayload());
      }
      return mockJson({ data: { id: "wh_1", status: "deleted" } });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.webhooks.delete("wh_1", {
      autoConfirm: { previewSummary: () => "admin approved endpoint removal" },
    });

    expect(paths).toEqual(["/api/v1/capability-confirmations", "/api/v1/webhooks/wh_1"]);
  });

  it("lets a per-call `autoConfirm: false` opt out of the client default", async () => {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      paths.push(new URL(url as string).pathname);
      return mockJson({ data: { id: "wh_1", status: "deleted" } });
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "n/a" },
    });
    await medal.webhooks.delete("wh_1", { autoConfirm: false });

    expect(paths).toEqual(["/api/v1/webhooks/wh_1"]);
  });

  it("does not re-mint when the caller already supplied both values", async () => {
    const paths: string[] = [];
    let seenHeaders: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      paths.push(new URL(url as string).pathname);
      seenHeaders = new Headers(init?.headers);
      return mockJson({ data: { id: "wh_1", status: "deleted" } });
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "n/a" },
    });
    await medal.webhooks.delete("wh_1", {
      idempotencyKey: "mine",
      capabilityConfirmation: "mine_token",
    });

    expect(paths).toEqual(["/api/v1/webhooks/wh_1"]);
    expect(seenHeaders?.get("idempotency-key")).toBe("mine");
    expect(seenHeaders?.get("x-capability-confirmation")).toBe("mine_token");
  });

  it("reuses a caller-supplied idempotency key when minting the token", async () => {
    let confirmBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      if (path === "/api/v1/capability-confirmations") {
        confirmBody = JSON.parse(init?.body as string);
        return mockJson(confirmationPayload());
      }
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("caller_key");
      return mockJson({ data: { id: "wh_1", status: "deleted" } });
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "approved" },
    });
    await medal.webhooks.delete("wh_1", { idempotencyKey: "caller_key" });

    expect(confirmBody?.idempotency_key).toBe("caller_key");
  });

  it("rejects an empty preview summary instead of asserting approval blindly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "wh_1", status: "deleted" } }),
    );
    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "   " },
    });
    await expect(medal.webhooks.delete("wh_1")).rejects.toThrow(/previewSummary/);
  });

  it("still works when a resource class is constructed directly with only a client", async () => {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      paths.push(path);
      if (path === "/api/v1/capability-confirmations") return mockJson(confirmationPayload());
      const headers = new Headers(init?.headers);
      if (path === "/api/v1/webhooks") {
        // No auto-confirm opted in — no headers minted.
        expect(headers.get("idempotency-key")).toBeNull();
        expect(headers.get("x-capability-confirmation")).toBeNull();
      }
      return mockJson({ data: { id: "x", status: "deleted" } });
    });

    const client = new BaseClient({
      baseUrl: BASE,
      token: "medal_test",
      timeout: 30000,
      userAgent: "test",
    });
    // Legacy one-argument construction must keep working.
    const webhooks = new Webhooks(client);
    expect(new Channels(client)).toBeInstanceOf(Channels);
    expect(new Helpdesk(client)).toBeInstanceOf(Helpdesk);

    await webhooks.create({ name: "n", url: "https://example.com/hook", event_types: [] });
    expect(paths).toEqual(["/api/v1/webhooks"]);

    // Per-call opt-in still works without a client-level default.
    await webhooks.delete("wh_1", { autoConfirm: { previewSummary: () => "approved" } });
    expect(paths).toEqual([
      "/api/v1/webhooks",
      "/api/v1/capability-confirmations",
      "/api/v1/webhooks/wh_1",
    ]);
  });

  it("hands the write payload to previewSummary", async () => {
    let confirmBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      if (path === "/api/v1/capability-confirmations") {
        confirmBody = JSON.parse(init?.body as string);
        return mockJson(confirmationPayload());
      }
      return mockJson({ data: { id: "cl_1", url: "https://connect.example.com/l/x" } }, 201);
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: {
        previewSummary: (ctx) => {
          // Narrowing on capabilityId gives the exact payload type.
          if (ctx.capabilityId === "channel.connect_link.create.execute") {
            return `Connect ${ctx.body.channel_type} for ${ctx.body.label}`;
          }
          return "other";
        },
      },
    });
    await medal.channels.connectLinks.create({
      channel_type: "telegram_inbox",
      label: "Acme support",
    });

    expect(confirmBody?.preview_summary).toBe("Connect telegram_inbox for Acme support");
  });

  it("produces different summaries for two different payloads on the same route", async () => {
    const summaries: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      if (path === "/api/v1/capability-confirmations") {
        summaries.push(JSON.parse(init?.body as string).preview_summary);
        return mockJson(confirmationPayload());
      }
      return mockJson({ data: { id: "m", conversation_id: "c_1", status: "created" } }, 201);
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: {
        previewSummary: (ctx) =>
          ctx.capabilityId === "helpdesk.conversation.reply.execute"
            ? `Reply to ${ctx.body.conversation_id}: ${ctx.body.body}`
            : "other",
      },
    });
    await medal.helpdesk.replies.create({ conversation_id: "c_1", body: "first answer" });
    await medal.helpdesk.replies.create({ conversation_id: "c_2", body: "second answer" });

    expect(summaries).toEqual(["Reply to c_1: first answer", "Reply to c_2: second answer"]);
    expect(summaries[0]).not.toBe(summaries[1]);
  });

  it("passes the payload through unmodified and exposes undefined for bodyless routes", async () => {
    const contexts: { capabilityId: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      if (path === "/api/v1/capability-confirmations") return mockJson(confirmationPayload());
      if (init?.method === "PATCH") {
        // The callback must not be able to alter what actually goes on the wire.
        expect(JSON.parse(init.body as string)).toEqual({ status: "closed" });
      }
      return mockJson({ data: { id: "x", status: "closed" } });
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: {
        previewSummary: (ctx) => {
          contexts.push({ capabilityId: ctx.capabilityId, body: ctx.body });
          return "approved";
        },
      },
    });

    const input = { status: "closed" } as const;
    await medal.helpdesk.conversations.update("c_1", input);
    await medal.channels.connections.disconnect("conn_1");

    // Same object identity — no clone, no redaction of the caller's own payload.
    expect(contexts[0].body).toBe(input);
    // DELETE routes have no request body.
    expect(contexts[1].capabilityId).toBe("channel.connection.disconnect.execute");
    expect(contexts[1].body).toBeUndefined();
  });

  it("covers helpdesk replies and conversation updates", async () => {
    const paths: string[] = [];
    const capabilityIds: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(url as string).pathname;
      paths.push(path);
      if (path === "/api/v1/capability-confirmations") {
        capabilityIds.push(JSON.parse(init?.body as string).capability_id);
        return mockJson(confirmationPayload());
      }
      return mockJson({ data: { id: "x", conversation_id: "c_1", status: "created" } }, 201);
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "agent approved" },
    });
    await medal.helpdesk.replies.create({ conversation_id: "c_1", body: "hi" });
    await medal.helpdesk.conversations.update("c_1", { status: "closed" });

    expect(capabilityIds).toEqual([
      "helpdesk.conversation.reply.execute",
      "helpdesk.conversation.update.execute",
    ]);
    expect(paths).toContain("/api/v1/helpdesk/replies");
    expect(paths).toContain("/api/v1/helpdesk/conversations/c_1");
  });
});

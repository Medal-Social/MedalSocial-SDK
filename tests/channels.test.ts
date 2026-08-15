import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("channels.connectLinks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("mints a connect link and returns the one-time url", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/channels/connect-links");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("idem_cl_1");
      const body = JSON.parse(init?.body as string);
      expect(body.channel_type).toBe("telegram_inbox");
      expect(body.label).toBe("Acme support");
      expect(body.redirect_url).toBe("https://partner.example.com/connected");
      return mockJson(
        {
          data: {
            id: "cl_1",
            url: "https://app.example.com/connect/link/cln_secret",
            channel_type: "telegram_inbox",
            label: "Acme support",
            status: "pending",
            expires_at: 1755100000000,
          },
        },
        201,
      );
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connectLinks.create(
      {
        channel_type: "telegram_inbox",
        label: "Acme support",
        redirect_url: "https://partner.example.com/connected",
      },
      { idempotencyKey: "idem_cl_1" },
    );
    expect(data.id).toBe("cl_1");
    expect(data.url).toBe("https://app.example.com/connect/link/cln_secret");
    expect(data.status).toBe("pending");
  });

  it("omits optional fields from the mint body when not provided", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ channel_type: "telegram_inbox" });
      return mockJson(
        {
          data: {
            id: "cl_2",
            url: "https://app.example.com/connect/link/cln_x",
            channel_type: "telegram_inbox",
            label: null,
            status: "pending",
            expires_at: 1755100000000,
          },
        },
        201,
      );
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connectLinks.create({
      channel_type: "telegram_inbox",
    });
    expect(data.label).toBeNull();
  });

  it("lists connect links with filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/channels/connect-links");
      expect(parsed.searchParams.get("channel_type")).toBe("telegram_inbox");
      expect(parsed.searchParams.get("status")).toBe("pending");
      return mockJson({
        data: [
          {
            id: "cl_1",
            channel_type: "telegram_inbox",
            label: "Acme support",
            status: "pending",
            consumed_connection_ref: null,
            expires_at: 1755100000000,
            created_at: 1755000000000,
          },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connectLinks.list({
      channel_type: "telegram_inbox",
      status: "pending",
    });
    expect(data).toHaveLength(1);
    expect(data[0].consumed_connection_ref).toBeNull();
  });

  it("lists connect links without params when no filters given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.search).toBe("");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connectLinks.list();
    expect(data).toEqual([]);
  });

  it("revokes a connect link", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/channels/connect-links/cl%201");
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { id: "cl 1", status: "revoked" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connectLinks.revoke("cl 1");
    expect(data.status).toBe("revoked");
  });
});

describe("channels.connections", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists channel connections", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/channels/connections");
      return mockJson({
        data: [
          {
            id: "conn_1",
            channel_type: "telegram_inbox",
            label: "Acme support",
            state: "active",
            masked_identity: "+47 •• •• 123",
            last_activity_at: 1755100000000,
            helpdesk_connection_id: "hc_1",
          },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connections.list();
    expect(data[0].state).toBe("active");
    expect(data[0].masked_identity).toBe("+47 •• •• 123");
  });

  it("disconnects a connection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/channels/connections/conn_1");
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { id: "conn_1", state: "disconnected" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.channels.connections.disconnect("conn_1");
    expect(data.state).toBe("disconnected");
  });

  it("surfaces API errors with code and status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "NOT_FOUND", message: "Connect link not found" } }, 404),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.channels.connectLinks.revoke("missing")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

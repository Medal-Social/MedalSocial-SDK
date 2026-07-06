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

describe("webhooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists webhook endpoints", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/webhooks");
      return mockJson({
        data: [{ id: "wh_1", name: "Bridge", url: "https://example.com/hook", enabled: true }],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.list();
    expect(data[0].id).toBe("wh_1");
  });

  it("creates an endpoint and returns the signing secret once", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/webhooks");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("idem_wh_1");
      const body = JSON.parse(init?.body as string);
      expect(body.name).toBe("Bridge");
      expect(body.url).toBe("https://example.com/hook");
      expect(body.event_types).toEqual(["helpdesk.message_received"]);
      expect(body.channels).toEqual(["widget"]);
      expect(body.channel_connection_ids).toEqual(["conn_1"]);
      return mockJson(
        {
          data: {
            id: "wh_1",
            name: "Bridge",
            url: "https://example.com/hook",
            enabled: true,
            event_types: ["helpdesk.message_received"],
            secret_last4: "ab12",
            secret: "whsec_secret_ab12",
          },
        },
        201,
      );
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.create(
      {
        name: "Bridge",
        url: "https://example.com/hook",
        event_types: ["helpdesk.message_received"],
        channels: ["widget"],
        channel_connection_ids: ["conn_1"],
      },
      { idempotencyKey: "idem_wh_1" },
    );
    expect(data.secret).toBe("whsec_secret_ab12");
    expect(data.secret_last4).toBe("ab12");
  });

  it("gets an endpoint by ID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/webhooks/wh_1");
      return mockJson({ data: { id: "wh_1", secret_last4: "ab12" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.get("wh_1");
    expect(data.id).toBe("wh_1");
    expect(data.secret).toBeUndefined();
  });

  it("updates an endpoint via PATCH", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/webhooks/wh_1");
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse(init?.body as string);
      expect(body.enabled).toBe(false);
      expect(body.event_types).toEqual([]);
      return mockJson({ data: { id: "wh_1", enabled: false } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.update("wh_1", { enabled: false, event_types: [] });
    expect(data.enabled).toBe(false);
  });

  it("deletes an endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/webhooks/wh_1");
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { id: "wh_1", status: "deleted" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.delete("wh_1");
    expect(data.status).toBe("deleted");
  });

  it("lists deliveries without a limit", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/webhooks/wh_1/deliveries");
      expect(parsed.searchParams.get("limit")).toBeNull();
      return mockJson({
        data: [
          {
            id: "del_1",
            event_type: "helpdesk.message_received",
            status: "delivered",
            attempt_count: 1,
          },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.deliveries("wh_1");
    expect(data[0].status).toBe("delivered");
  });

  it("lists deliveries with a limit", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("limit")).toBe("5");
      return mockJson({ data: [] });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.webhooks.deliveries("wh_1", { limit: 5 });
  });

  it("queues a test delivery", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toContain("/api/v1/webhooks/wh_1/test");
      expect(init?.method).toBe("POST");
      return mockJson({ data: { delivery_id: "del_2", status: "queued" } }, 202);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.webhooks.test("wh_1");
    expect(data.delivery_id).toBe("del_2");
    expect(data.status).toBe("queued");
  });

  it("encodes endpoint IDs in paths", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toContain("/api/v1/webhooks/wh%2F1");
      return mockJson({ data: { id: "wh/1" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.webhooks.get("wh/1");
  });
});

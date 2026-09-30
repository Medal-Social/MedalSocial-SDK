import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

function medal() {
  return new Medal("medal_test", { baseUrl: BASE });
}

const TODAY_PAYLOAD = {
  data: {
    date_key: 20260911,
    time_zone: "Europe/Oslo",
    opens_minute: 540,
    closes_minute: 1020,
    closed_for_today: false,
    next_open: null,
    on_duty_count: 3,
    total: 12,
    completed: 5,
    remaining: 6,
    no_show: 1,
    cancelled: 0,
    next_gap: {
      resource_id: "rs_1",
      start_minute: 720,
      end_minute: 780,
      start_ts: "2026-09-11T10:00:00.000Z",
    },
    revenue: {
      total_ore: 250_000,
      by_provider: [{ provider: "vipps", amount_ore: 150_000, count: 2 }],
    },
    truncated: false,
  },
};

describe("bookings.today (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads the salon's operating summary for the workspace's own date", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(url as string);
      return mockJson(TODAY_PAYLOAD);
    });

    const { data } = await medal().bookings.today();
    expect(seen[0]).toBe(`${BASE}/api/v1/bookings/today`);
    expect(data.revenue.by_provider[0].amount_ore).toBe(150_000);
    expect(data.next_gap?.start_ts).toBe("2026-09-11T10:00:00.000Z");
  });

  it("passes an explicit yyyymmdd date_key", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(url as string);
      return mockJson(TODAY_PAYLOAD);
    });

    await medal().bookings.today({ date_key: 20261224 });
    expect(seen[0]).toBe(`${BASE}/api/v1/bookings/today?date_key=20261224`);
  });
});

describe("bookings.attention (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the feed with its own truncated/total envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/attention`);
      return mockJson({
        data: [
          {
            id: "att_1",
            kind: "payment_failed",
            occurred_at: "2026-09-11T08:00:00.000Z",
            booking_id: "bk_1",
            event_id: null,
            contact_id: "c_1",
            resource_id: null,
            amount_ore: 49_900,
            count: null,
            deadline_at: null,
          },
        ],
        truncated: true,
        total: 42,
      });
    });

    const feed = await medal().bookings.attention();
    expect(feed.data[0].kind).toBe("payment_failed");
    // `truncated` is a read-budget flag, not a cursor: there is nothing to page.
    expect(feed.truncated).toBe(true);
    expect(feed.total).toBe(42);
  });
});

const HOST = {
  id: "eh_1",
  name: "Sol barnehage",
  slug: "sol-barnehage",
  address: "Solveien 1",
  note: "inngang B",
  retired: false,
};

describe("bookings.events.hosts (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists hosts so a landing page can resolve one by slug", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/events/hosts`);
      return mockJson({ data: [HOST] });
    });
    const { data } = await medal().bookings.events.hosts.list();
    expect(data[0].slug).toBe("sol-barnehage");
  });

  it("find-or-creates a host by name, under an idempotency key", async () => {
    let key: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/events/hosts`);
      expect(init?.method).toBe("POST");
      key = new Headers(init?.headers).get("idempotency-key");
      return mockJson({ data: HOST }, 201);
    });
    const { data } = await medal().bookings.events.hosts.create({
      name: "Sol barnehage",
      address: "Solveien 1",
    });
    expect(data.id).toBe("eh_1");
    expect(key).toBeTruthy();
  });

  it("patches a host's address, and `null` erases it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/events/hosts/eh_1`);
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(init?.body as string)).toEqual({ address: null, retired: true });
      return mockJson({ data: { ...HOST, address: null, retired: true } });
    });
    const { data } = await medal().bookings.events.hosts.update("eh_1", {
      address: null,
      retired: true,
    });
    expect(data.address).toBeNull();
    expect(data.retired).toBe(true);
  });
});

describe("bookings.events.remove (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deletes an arrangement day and reports hard vs soft", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/events/ev_1`);
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { success: true, mode: "soft" } });
    });
    const { data } = await medal().bookings.events.remove("ev_1");
    expect(data.mode).toBe("soft");
  });

  it("exposes the same call as `delete`", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/bookings/events/ev_2`);
      expect(init?.method).toBe("DELETE");
      return mockJson({ data: { success: true, mode: "hard" } });
    });
    const { data } = await medal().bookings.events.delete("ev_2");
    expect(data.mode).toBe("hard");
  });
});

describe("catalogue namespaces (SDK-19)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("bookings.services.list() and the flat listServices() hit one route", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(new URL(url as string).pathname);
      return mockJson({ data: [] });
    });
    const client = medal();
    await client.bookings.services.list();
    await client.bookings.listServices({ include_inactive: true });
    expect(seen).toEqual(["/api/v1/bookings/services", "/api/v1/bookings/services"]);
  });

  it("bookings.resources.list() and the flat listResources() hit one route", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(new URL(url as string).pathname);
      return mockJson({ data: [] });
    });
    const client = medal();
    await client.bookings.resources.list();
    await client.bookings.listResources();
    expect(seen).toEqual(["/api/v1/bookings/resources", "/api/v1/bookings/resources"]);
  });

  it("forwards include_inactive from the namespaced services.list()", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(url as string);
      return mockJson({ data: [] });
    });
    await medal().bookings.services.list({ include_inactive: true });
    expect(seen[0]).toBe(`${BASE}/api/v1/bookings/services?include_inactive=true`);
  });
});

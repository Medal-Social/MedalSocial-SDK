import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedResponse } from "../src";
import { Medal, MedalApiError, paginate } from "../src";

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

/** Two pages of `{ id }` rows, keyed off the `cursor` query parameter. */
function pagedFetch(pages: Record<string, { ids: string[]; next: string | null }>) {
  const seen: (string | null)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const cursor = new URL(url as string).searchParams.get("cursor");
    seen.push(cursor);
    const page = pages[cursor ?? ""];
    return mockJson({
      data: page.ids.map((id) => ({ id })),
      pagination: { has_more: page.next !== null, next_cursor: page.next },
    });
  });
  return seen;
}

describe("paginate (SDK-10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("walks every page and yields rows one by one", async () => {
    const calls: (string | undefined)[] = [];
    const pages: Record<string, PaginatedResponse<{ id: string }>> = {
      first: {
        data: [{ id: "a" }, { id: "b" }],
        pagination: { has_more: true, next_cursor: "c2" },
      },
      c2: { data: [{ id: "c" }], pagination: { has_more: false, next_cursor: null } },
    };

    const seen: string[] = [];
    for await (const row of paginate<{ id: string }>(async (cursor) => {
      calls.push(cursor);
      return pages[cursor ?? "first"];
    })) {
      seen.push(row.id);
    }

    expect(seen).toEqual(["a", "b", "c"]);
    expect(calls).toEqual([undefined, "c2"]);
  });

  it("stops on a short page that still claims has_more but has no cursor", async () => {
    // The trap the helpdesk filters make real: filtering happens WITHIN a page,
    // so a page can be short. Driving the loop off has_more is right — but a
    // has_more with no cursor would loop forever, so it ends the walk.
    const seen: string[] = [];
    for await (const row of paginate<{ id: string }>(async () => ({
      data: [{ id: "only" }],
      pagination: { has_more: true, next_cursor: null },
    }))) {
      seen.push(row.id);
    }
    expect(seen).toEqual(["only"]);
  });

  it("yields nothing for an empty first page", async () => {
    const seen: string[] = [];
    for await (const row of paginate<{ id: string }>(async () => ({
      data: [],
      pagination: { has_more: false, next_cursor: null },
    }))) {
      seen.push(row.id);
    }
    expect(seen).toEqual([]);
  });
});

describe("resource iterators (SDK-10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const iterators: [string, (m: Medal) => AsyncIterable<{ id: string }>, string][] = [
    ["contacts", (m) => m.contacts.iter({ status: "lead" }), "/api/v1/contacts"],
    ["deals", (m) => m.deals.iter({ status: "signed" }), "/api/v1/deals"],
    ["posts", (m) => m.posts.iter({ status: "published" }), "/api/v1/posts"],
    [
      "helpdesk.conversations",
      (m) => m.helpdesk.conversations.iter({ status: "open" }) as AsyncIterable<{ id: string }>,
      "/api/v1/helpdesk/conversations",
    ],
    [
      "channels.connectLinks",
      (m) => m.channels.connectLinks.iter({ status: "pending" }) as AsyncIterable<{ id: string }>,
      "/api/v1/channels/connect-links",
    ],
    [
      "channels.connections",
      (m) => m.channels.connections.iter() as AsyncIterable<{ id: string }>,
      "/api/v1/channels/connections",
    ],
  ];

  it.each(iterators)("%s.iter() walks both pages of one route", async (_name, iter, path) => {
    const seen = pagedFetch({
      "": { ids: ["1", "2"], next: "cur2" },
      cur2: { ids: ["3"], next: null },
    });

    const ids: string[] = [];
    for await (const row of iter(medal())) ids.push(row.id);

    expect(ids).toEqual(["1", "2", "3"]);
    expect(seen).toEqual([null, "cur2"]);
    const urls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map((call) => new URL(call[0] as string).pathname);
    expect(new Set(urls)).toEqual(new Set([path]));
  });

  it("keeps the caller's filters on every page", async () => {
    pagedFetch({
      "": { ids: ["1"], next: "cur2" },
      cur2: { ids: ["2"], next: null },
    });

    for await (const _row of medal().contacts.iter({ status: "lead", limit: 2 })) {
      // drain
    }

    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("status=lead");
    expect(urls[0]).toContain("limit=2");
    expect(urls[1]).toContain("status=lead");
    expect(urls[1]).toContain("cursor=cur2");
  });

  it("stops early when the consumer breaks out of the loop", async () => {
    pagedFetch({
      "": { ids: ["1", "2"], next: "cur2" },
      cur2: { ids: ["3"], next: null },
    });

    const ids: string[] = [];
    for await (const row of medal().contacts.iter()) {
      ids.push(row.id);
      break;
    }

    expect(ids).toEqual(["1"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("bookings.payment.waitForSettlement (SDK-11)", () => {
  beforeEach(() => vi.restoreAllMocks());

  function paymentPayload(state: string) {
    return {
      data: {
        reference: "pay_1",
        provider: "vipps",
        state,
        mode: "reserve",
        attempt: 1,
        amount_ore: 49_900,
        authorized_ore: state === "created" ? 0 : 49_900,
        captured_ore: 0,
        refunded_ore: 0,
        cancelled_ore: 0,
        currency: "NOK",
        capture_guaranteed_until: null,
        terms_version: null,
        terms_accepted_at: null,
        failure_code: null,
        created_at: null,
        updated_at: null,
      },
    };
  }

  it("polls until the payment settles, then resolves with it", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(mockJson(paymentPayload("created")));
    spy.mockResolvedValueOnce(mockJson(paymentPayload("authorized")));

    const payment = await medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 1 });

    expect(payment.state).toBe("authorized");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[0][0])).toBe(`${BASE}/api/v1/bookings/bk_1/payment`);
  });

  it.each(["captured", "cancelled", "failed", "expired", "refunded"])(
    "treats %s as settled",
    async (state) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockJson(paymentPayload(state)));
      const payment = await medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 1 });
      expect(payment.state).toBe(state);
    },
  );

  it("throws once the deadline passes with the payment still unsettled", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson(paymentPayload("created")),
    );

    await expect(
      medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/did not settle within/i);
  });

  it("needs no options at all when the payment has already settled", async () => {
    // Also the only call that exercises the default interval and timeout: a
    // payment that is settled on the first read never sleeps.
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => mockJson(paymentPayload("captured")));

    const payment = await medal().bookings.payment.waitForSettlement("bk_1");

    expect(payment.state).toBe("captured");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives up after one poll when the budget is already exhausted", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => mockJson(paymentPayload("created")));

    await expect(
      medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 5, timeoutMs: 0 }),
    ).rejects.toThrow(/did not settle within 0ms/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not poll again after a sleep that consumed the whole budget", async () => {
    // interval > remaining, so the sleep is clamped to the remaining budget and
    // the deadline has passed by the time it returns.
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => mockJson(paymentPayload("created")));

    await expect(
      medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 500, timeoutMs: 10 }),
    ).rejects.toThrow(/did not settle within 10ms/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 404 rather than polling a booking with no payment", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "NOT_FOUND", message: "No payment" } }, 404),
    );

    await expect(
      medal().bookings.payment.waitForSettlement("bk_1", { intervalMs: 1 }),
    ).rejects.toBeInstanceOf(MedalApiError);
  });

  it("polls the manage-token route too, on its own faster bucket", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(mockJson(paymentPayload("created")));
    spy.mockResolvedValueOnce(mockJson(paymentPayload("captured")));

    const payment = await medal().bookings.manage.payment.waitForSettlement("tok_1", {
      intervalMs: 1,
    });

    expect(payment.state).toBe("captured");
    expect(String(spy.mock.calls[0][0])).toBe(`${BASE}/api/v1/bookings/manage/tok_1/payment`);
  });

  it("ignores a nonsense interval or timeout instead of polling forever", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(mockJson(paymentPayload("created")));
    spy.mockResolvedValueOnce(mockJson(paymentPayload("authorized")));

    const payment = await medal().bookings.payment.waitForSettlement("bk_1", {
      intervalMs: Number.NaN,
      timeoutMs: Number.NaN,
    });

    expect(payment.state).toBe("authorized");
  });
});

describe("portal.session (SDK-12)", () => {
  beforeEach(() => vi.restoreAllMocks());

  function recordRequests() {
    const calls: { path: string; method: string; session: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        path: new URL(url as string).pathname,
        method: init?.method ?? "GET",
        session: headers.get("x-portal-session"),
      });
      return mockJson({ data: { contact_id: "c_1" } });
    });
    return calls;
  }

  it("binds the token once for every self-service call", async () => {
    const calls = recordRequests();
    const me = medal().portal.session("ps_token");

    await me.profile();
    await me.update({ first_name: "Ida" });
    await me.bookings();
    await me.export();
    await me.delete();
    await me.logout();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/v1/portal/me",
      "PATCH /api/v1/portal/me",
      "GET /api/v1/portal/me/bookings",
      "POST /api/v1/portal/me/export",
      "POST /api/v1/portal/me/delete",
      "POST /api/v1/portal/logout",
    ]);
    expect(new Set(calls.map((call) => call.session))).toEqual(new Set(["ps_token"]));
  });

  it("exposes the token it is bound to", () => {
    expect(medal().portal.session("ps_token").token).toBe("ps_token");
  });

  it("leaves the flat, session-first methods working", async () => {
    const calls = recordRequests();
    await medal().portal.me("ps_token");
    expect(calls).toEqual([{ path: "/api/v1/portal/me", method: "GET", session: "ps_token" }]);
  });
});

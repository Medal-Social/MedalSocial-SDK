import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalOrderingOrder, PortalOrderingPreferences, PortalOrderingReorder } from "../src";
import { Medal, MedalApiError } from "../src";

const BASE = "https://test.convex.site";
const SESSION = "sess_1";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function apiError(status: number, code: string, message = "Refused") {
  return mockJson({ error: { code, message } }, status);
}

function unavailable() {
  return new Response("", { status: 503, statusText: "Error" });
}

function medal() {
  return new Medal("medal_test", { baseUrl: BASE });
}

async function failure(promise: Promise<unknown>): Promise<MedalApiError> {
  return (await promise.catch((e: unknown) => e)) as MedalApiError;
}

const PREFS: PortalOrderingPreferences = {
  addresses: [
    {
      id: "sa_1",
      label: "Hjem",
      address_id: "addr_1",
      address: { street: "Storgata", house_number: "1A", post_code: "0155", city: "Oslo" },
      floor: "3",
      comment: null,
      has_door_code: true,
      last_used_at: "2026-10-28T12:00:00.000Z",
    },
    {
      id: "sa_2",
      label: "Jobb",
      address_id: "addr_2",
      address: null,
      floor: null,
      comment: "Ring på",
      has_door_code: false,
      last_used_at: "2026-10-20T12:00:00.000Z",
    },
  ],
  allergy_note: "Peanøtter",
  cutlery_default: false,
  contactless_default: true,
  favourites: ["p_1", "p_2"],
  marketing_consent: { given: true, at: "2026-10-28T12:00:00.000Z", source: "order_checkout" },
};

const ORDERS: PortalOrderingOrder[] = [
  {
    order_id: "ord_2",
    order_number: "P-1028-002",
    status: "handed_over",
    channel: "delivery",
    location_id: "loc_1",
    created_at: "2026-10-28T17:00:00.000Z",
    lines: [{ product_id: "p_1", name: "Burger", quantity: 2, options: ["Ost"] }],
    total_ore: 31800,
  },
];

const REORDER: PortalOrderingReorder = {
  location_id: "loc_1",
  channel: "takeaway",
  cart: {
    lines: [
      {
        product_id: "p_1",
        name: "Burger",
        quantity: 2,
        option_ids: ["o_1"],
        options: ["Ost"],
        note: "Godt stekt",
        unit_price_ore: 16900,
        line_total_ore: 33800,
      },
    ],
    subtotal_ore: 33800,
    total_ore: 33800,
  },
  dropped: [{ name: "Milkshake", reason: "sold_out" }],
};

/** Asserts one request's method, path, session header and body, then answers `response`. */
function expectCall(
  method: string,
  path: string,
  body: unknown,
  response: () => Response,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe(`${BASE}${path}`);
    expect(init?.method).toBe(method);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-portal-session")).toBe(SESSION);
    expect(headers.get("authorization")).toBe("Bearer medal_test");
    expect(headers.get("idempotency-key")).toBeNull();
    if (body === undefined) expect(init?.body ?? undefined).toBeUndefined();
    else expect(JSON.parse(init?.body as string)).toEqual(body);
    return response();
  });
}

describe("portal.ordering.preferences", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("get reads the profile with the session header", async () => {
    expectCall("GET", "/api/v1/portal/ordering/preferences", undefined, () =>
      mockJson({ data: PREFS }),
    );
    const { data } = await medal().portal.ordering.preferences.get(SESSION);
    expect(data).toEqual(PREFS);
  });

  it("get retries a transient 503 — a read duplicates nothing", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(mockJson({ data: PREFS }));
    await medal().portal.ordering.preferences.get(SESSION);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("update PUTs the patch as sent, null allergy note included", async () => {
    const patch = {
      allergy_note: null,
      cutlery_default: true,
      contactless_default: false,
      favourites: ["p_3"],
      marketing_consent: false,
    };
    expectCall("PUT", "/api/v1/portal/ordering/preferences", patch, () =>
      mockJson({ data: { ...PREFS, allergy_note: null } }),
    );
    const { data } = await medal().portal.ordering.preferences.update(SESSION, patch);
    expect(data.allergy_note).toBeNull();
  });

  it("update is sent exactly once — a consent change would be recorded twice", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(unavailable());
    const err = await failure(
      medal().portal.ordering.preferences.update(SESSION, { marketing_consent: true }),
    );
    expect(err.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces FAVOURITE_LIMIT as a typed 422", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(422, "FAVOURITE_LIMIT"));
    const err = await failure(
      medal().portal.ordering.preferences.update(SESSION, { favourites: ["p_1"] }),
    );
    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("FAVOURITE_LIMIT");
  });

  it("surfaces ORDERING_NOT_ENABLED and PORTAL_SESSION_INVALID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(apiError(403, "ORDERING_NOT_ENABLED"));
    const off = await failure(medal().portal.ordering.preferences.get(SESSION));
    expect([off.status, off.code]).toEqual([403, "ORDERING_NOT_ENABLED"]);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(apiError(401, "PORTAL_SESSION_INVALID"));
    const dead = await failure(medal().portal.ordering.preferences.get(SESSION));
    expect([dead.status, dead.code]).toEqual([401, "PORTAL_SESSION_INVALID"]);
  });
});

describe("portal.ordering.addresses", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("add POSTs the address and answers the profile (201)", async () => {
    const input = {
      address_id: "addr_1",
      label: "Hjem",
      door_code: "1234",
      floor: "3",
      comment: "Bak huset",
    };
    expectCall("POST", "/api/v1/portal/ordering/addresses", input, () =>
      mockJson({ data: PREFS }, 201),
    );
    const { data } = await medal().portal.ordering.addresses.add(SESSION, input);
    expect(data.addresses[0]?.has_door_code).toBe(true);
  });

  it("add is sent exactly once — a retry would save the address twice", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(unavailable());
    await failure(medal().portal.ordering.addresses.add(SESSION, { address_id: "addr_1" }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("add surfaces ADDRESS_LIMIT and ADDRESS_NOT_VERIFIED", async () => {
    for (const code of ["ADDRESS_LIMIT", "ADDRESS_NOT_VERIFIED"]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(apiError(422, code));
      const err = await failure(
        medal().portal.ordering.addresses.add(SESSION, { address_id: "addr_9" }),
      );
      expect([err.status, err.code]).toEqual([422, code]);
    }
  });

  it("remove DELETEs the URL-encoded, trimmed id", async () => {
    expectCall("DELETE", "/api/v1/portal/ordering/addresses/sa%2F1", undefined, () =>
      mockJson({ data: PREFS }),
    );
    const { data } = await medal().portal.ordering.addresses.remove(SESSION, " sa/1 ");
    expect(data).toEqual(PREFS);
  });

  it("remove is sent exactly once and surfaces ADDRESS_NOT_FOUND", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(unavailable());
    await failure(medal().portal.ordering.addresses.remove(SESSION, "sa_1"));
    expect(spy).toHaveBeenCalledTimes(1);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(404, "ADDRESS_NOT_FOUND"));
    const err = await failure(medal().portal.ordering.addresses.remove(SESSION, "sa_x"));
    expect([err.status, err.code]).toEqual([404, "ADDRESS_NOT_FOUND"]);
  });
});

describe("portal.ordering.favourites", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("add PUTs the product id with no body", async () => {
    expectCall("PUT", "/api/v1/portal/ordering/favourites/p_3", undefined, () =>
      mockJson({ data: { ...PREFS, favourites: ["p_1", "p_2", "p_3"] } }),
    );
    const { data } = await medal().portal.ordering.favourites.add(SESSION, "p_3");
    expect(data.favourites).toContain("p_3");
  });

  it("remove DELETEs the product id", async () => {
    expectCall("DELETE", "/api/v1/portal/ordering/favourites/p_1", undefined, () =>
      mockJson({ data: { ...PREFS, favourites: ["p_2"] } }),
    );
    const { data } = await medal().portal.ordering.favourites.remove(SESSION, "p_1");
    expect(data.favourites).toEqual(["p_2"]);
  });

  it("add and remove retry a transient 503 — both reach the same state again", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(mockJson({ data: PREFS }))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(mockJson({ data: PREFS }));
    await medal().portal.ordering.favourites.add(SESSION, "p_1");
    await medal().portal.ordering.favourites.remove(SESSION, "p_1");
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("add surfaces PRODUCT_NOT_FOUND", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(422, "PRODUCT_NOT_FOUND"));
    const err = await failure(medal().portal.ordering.favourites.add(SESSION, "p_gone"));
    expect([err.status, err.code]).toEqual([422, "PRODUCT_NOT_FOUND"]);
  });
});

describe("portal.ordering.orders", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("list reads the last orders", async () => {
    expectCall("GET", "/api/v1/portal/ordering/orders", undefined, () =>
      mockJson({ data: ORDERS }),
    );
    const { data } = await medal().portal.ordering.orders.list(SESSION);
    expect(data).toEqual(ORDERS);
  });

  it("reorder POSTs with no body and answers the cart and dropped lines", async () => {
    expectCall("POST", "/api/v1/portal/ordering/orders/ord_2/reorder", undefined, () =>
      mockJson({ data: REORDER }),
    );
    const { data } = await medal().portal.ordering.orders.reorder(SESSION, "ord_2");
    expect(data).toEqual(REORDER);
    expect(data.dropped[0]?.reason).toBe("sold_out");
  });

  it("reorder retries a transient 503 — it places nothing", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(mockJson({ data: REORDER }));
    await medal().portal.ordering.orders.reorder(SESSION, "ord_2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reorder surfaces ORDER_NOT_FOUND for an order that is not the customer's", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(404, "ORDER_NOT_FOUND"));
    const err = await failure(medal().portal.ordering.orders.reorder(SESSION, "ord_other"));
    expect([err.status, err.code]).toEqual([404, "ORDER_NOT_FOUND"]);
  });
});

describe("portal.ordering path ids", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    ["a blank id", "  "],
    ["an over-long id", "x".repeat(65)],
    ["a non-string id", 42 as unknown as string],
  ])("throws RangeError before any request for %s", async (_label, id) => {
    const spy = vi.spyOn(globalThis, "fetch");
    const ordering = medal().portal.ordering;
    await expect(ordering.addresses.remove(SESSION, id)).rejects.toThrow(RangeError);
    await expect(ordering.favourites.add(SESSION, id)).rejects.toThrow(RangeError);
    await expect(ordering.favourites.remove(SESSION, id)).rejects.toThrow(RangeError);
    await expect(ordering.orders.reorder(SESSION, id)).rejects.toThrow(/must be 1-64 characters/);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([".", ".."])("refuses the dot segment %j", async (id) => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(medal().portal.ordering.orders.reorder(SESSION, id)).rejects.toThrow(
      `portal.ordering.orders.reorder: orderId must not be "${id}"`,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("portal.session(token).ordering", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards every call with the bound token", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new Headers(init?.headers).get("x-portal-session")).toBe(SESSION);
      const path = new URL(url as string).pathname;
      calls.push(`${init?.method} ${path}`);
      if (path === "/api/v1/portal/ordering/orders") return mockJson({ data: ORDERS });
      if (path.endsWith("/reorder")) return mockJson({ data: REORDER });
      return mockJson({ data: PREFS });
    });

    const me = medal().portal.session(SESSION).ordering;
    expect((await me.preferences()).data).toEqual(PREFS);
    await me.updatePreferences({ cutlery_default: true });
    await me.addAddress({ address_id: "addr_1" });
    await me.removeAddress("sa_1");
    await me.addFavourite("p_1");
    await me.removeFavourite("p_1");
    expect((await me.orders()).data).toEqual(ORDERS);
    expect((await me.reorder("ord_2")).data).toEqual(REORDER);

    expect(calls).toEqual([
      "GET /api/v1/portal/ordering/preferences",
      "PUT /api/v1/portal/ordering/preferences",
      "POST /api/v1/portal/ordering/addresses",
      "DELETE /api/v1/portal/ordering/addresses/sa_1",
      "PUT /api/v1/portal/ordering/favourites/p_1",
      "DELETE /api/v1/portal/ordering/favourites/p_1",
      "GET /api/v1/portal/ordering/orders",
      "POST /api/v1/portal/ordering/orders/ord_2/reorder",
    ]);
  });
});

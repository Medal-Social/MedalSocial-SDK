import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseClient, Medal, MedalApiError, type OrderingMenu } from "../src";

const BASE = "https://test.convex.site";
const ETAG = 'W/"0123456789abcdef"';

const MENU: OrderingMenu = {
  categories: [
    {
      id: "cat_1",
      name: "Pizza",
      items: [
        {
          id: "item_1",
          name: "Margherita",
          description: "Tomato, mozzarella, basil",
          price_ore: 16900,
          vat_bp: 1500,
          image_url: "https://cdn.example.com/margherita.jpg",
          allergens: ["gluten", "milk"],
          dietary: ["vegetarian"],
          sold_out: false,
          modifier_groups: [
            {
              id: "grp_1",
              name: "Size",
              min_select: 1,
              max_select: 1,
              options: [
                {
                  id: "opt_1",
                  name: "Large",
                  price_delta_ore: 4000,
                  allergens: [],
                  vat_bp: 1500,
                  sold_out: false,
                },
              ],
            },
          ],
        },
        {
          id: "item_2",
          name: "Garlic bread",
          price_ore: 5900,
          vat_bp: 1500,
          allergens: ["gluten"],
          dietary: ["vegan"],
          sold_out: true,
          modifier_groups: [],
        },
      ],
    },
  ],
  etag: ETAG,
  channel: "takeaway",
  at: "2026-10-21T12:00:00.000Z",
};

function menuResponse(etag: string | null = ETAG) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "private, no-store",
    vary: "Authorization",
  };
  if (etag) headers.etag = etag;
  return new Response(JSON.stringify({ data: MENU }), { status: 200, headers });
}

function notModified(etag: string | null = ETAG) {
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  if (etag) headers.etag = etag;
  return new Response(null, { status: 304, headers });
}

function medal() {
  return new Medal("medal_test", { baseUrl: BASE });
}

describe("ordering.menu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs /api/v1/ordering/menu with channel, location and an ISO `at`, authenticated", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/ordering/menu");
      expect(parsed.searchParams.get("channel")).toBe("takeaway");
      expect(parsed.searchParams.get("location")).toBe("loc_1");
      expect(parsed.searchParams.get("at")).toBe("2026-10-21T12:00:00.000Z");
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      expect(headers.has("if-none-match")).toBe(false);
      return menuResponse();
    });

    const result = await medal().ordering.menu({
      channel: "takeaway",
      location: "loc_1",
      at: new Date("2026-10-21T12:00:00.000Z"),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ notModified: false, etag: ETAG, menu: MENU });
  });

  it("omits unset optional query parameters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect([...parsed.searchParams.keys()]).toEqual(["channel"]);
      expect(parsed.searchParams.get("channel")).toBe("dine_in");
      return menuResponse();
    });
    const result = await medal().ordering.menu({ channel: "dine_in" });
    expect(result.notModified).toBe(false);
  });

  it("sends Unix milliseconds as digits and an ISO string unchanged", async () => {
    const seen: (string | null)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(new URL(url as string).searchParams.get("at"));
      return menuResponse();
    });
    await medal().ordering.menu({ channel: "delivery", at: 1_792_584_000_000 });
    await medal().ordering.menu({ channel: "delivery", at: "2026-10-21T14:00:00+02:00" });
    expect(seen).toEqual(["1792584000000", "2026-10-21T14:00:00+02:00"]);
  });

  it.each([1.5, -1, Number.NaN])("refuses `at: %s` before sending anything", async (at) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(medal().ordering.menu({ channel: "takeaway", at })).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the body's etag when the response has no ETag header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(menuResponse(null));
    const result = await medal().ordering.menu({ channel: "takeaway" });
    expect(result.etag).toBe(ETAG);
  });

  it("sends If-None-Match verbatim and resolves notModified on 304", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe(ETAG);
      return notModified();
    });
    const result = await medal().ordering.menu({ channel: "takeaway", ifNoneMatch: ETAG });
    expect(result).toEqual({ notModified: true, etag: ETAG });
    expect("menu" in result).toBe(false);
  });

  it("keeps the sent tag when a 304 arrives without an ETag header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(notModified(null));
    const result = await medal().ordering.menu({ channel: "takeaway", ifNoneMatch: ETAG });
    expect(result).toEqual({ notModified: true, etag: ETAG });
  });

  it("reports an empty etag for a 304 nobody asked for", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(notModified(null));
    const result = await medal().ordering.menu({ channel: "takeaway" });
    expect(result).toEqual({ notModified: true, etag: "" });
  });

  it("returns the new menu when the sent tag is stale", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(menuResponse('W/"fedcba9876543210"'));
    const result = await medal().ordering.menu({ channel: "takeaway", ifNoneMatch: ETAG });
    expect(result.notModified).toBe(false);
    expect(result.etag).toBe('W/"fedcba9876543210"');
  });

  it("maps 403 ORDERING_NOT_ENABLED to MedalApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "ORDERING_NOT_ENABLED",
            message: "Online ordering is not enabled for this workspace",
          },
        }),
        { status: 403, headers: { "content-type": "application/json", "x-request-id": "req_1" } },
      ),
    );
    const err = (await medal()
      .ordering.menu({ channel: "takeaway" })
      .catch((e: unknown) => e)) as MedalApiError;
    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("ORDERING_NOT_ENABLED");
    expect(err.requestId).toBe("req_1");
  });

  it("passes the caller's AbortSignal through", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.menu({ channel: "takeaway" }, { signal: controller.signal }),
    ).rejects.toThrow("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("BaseClient.getConditional", () => {
  beforeEach(() => vi.restoreAllMocks());

  const client = () =>
    new BaseClient({ baseUrl: BASE, token: "t", timeout: 1000, userAgent: "test" });

  it("lets the named ifNoneMatch replace a same-named header bag entry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe(ETAG);
      expect(headers.get("x-extra")).toBe("1");
      return notModified();
    });
    const res = await client().getConditional("/api/v1/x", undefined, {
      headers: { "If-None-Match": "stale", "X-Extra": "1" },
      ifNoneMatch: ` ${ETAG} `,
    });
    expect(res).toEqual({ notModified: true, etag: ETAG });
  });

  it("treats a blank ifNoneMatch as none", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return menuResponse();
    });
    const res = await client().getConditional<{ data: OrderingMenu }>("/api/v1/x", undefined, {
      ifNoneMatch: "   ",
    });
    expect(res.notModified).toBe(false);
  });

  it("still throws a 304 from a plain get()", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(notModified());
    await expect(client().get("/api/v1/x")).rejects.toMatchObject({ status: 304 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DeliveryAddressSuggestion,
  type DeliveryQuote,
  type DeliveryQuoteInput,
  type DeliveryResolvedAddress,
  Medal,
  MedalApiError,
  type MedalErrorCode,
} from "../src";

const BASE = "https://test.convex.site";
const SESSION = "3f2c9a10-7d4e-4b8a-9c11-2a6f0e5b7d33";

const SUGGESTIONS: DeliveryAddressSuggestion[] = [
  { id: "kv_1", label: "Storgata 1", secondary: "0155 Oslo" },
  { id: "kv_2", label: "Storgata 10", secondary: "0155 Oslo" },
];

const ADDRESS: DeliveryResolvedAddress = {
  address_id: "addr_1",
  label: "Storgata 1, 0155 Oslo",
  street: "Storgata",
  house_number: "1",
  post_code: "0155",
  city: "Oslo",
  lat: 59.9133,
  lon: 10.7522,
  source: "kartverket",
};

const QUOTE: DeliveryQuote = {
  quote_id: "q_1",
  customer_fee: { amount: 4900, currency: "NOK" },
  cost: { amount: 8900, currency: "NOK" },
  eta_minutes: 35,
  delivered_by: "2026-10-29T17:35:00.000Z",
  valid_until: "2026-10-29T17:10:00.000Z",
  address: "Storgata 1, 0155 Oslo",
  venue_id: "venue_1",
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: MedalErrorCode, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_1" },
  });
}

function medal() {
  return new Medal("medal_test", { baseUrl: BASE });
}

async function failure(promise: Promise<unknown>): Promise<MedalApiError> {
  return (await promise.catch((e: unknown) => e)) as MedalApiError;
}

describe("delivery.addresses.suggest", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs the query and session, with the caller's signal, and returns the envelope", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/delivery/addresses");
      expect(parsed.searchParams.get("q")).toBe("storgata 1");
      expect(parsed.searchParams.get("session")).toBe(SESSION);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer medal_test");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return ok(SUGGESTIONS);
    });

    const result = await medal().delivery.addresses.suggest("storgata 1", {
      session: SESSION,
      signal: controller.signal,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: SUGGESTIONS });
  });

  it("sends no session when none is given, and passes a short query to the server", async () => {
    const urls: URL[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      urls.push(new URL(url as string));
      return ok([]);
    });

    const result = await medal().delivery.addresses.suggest("st");

    expect(result.data).toEqual([]);
    expect(urls[0].searchParams.get("q")).toBe("st");
    expect(urls[0].searchParams.has("session")).toBe(false);
  });

  it("aborts with the caller's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok(SUGGESTIONS));
    const controller = new AbortController();
    controller.abort();

    await expect(
      medal().delivery.addresses.suggest("storgata", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each<[string, unknown, string | undefined]>([
    ["an over-long query", "x".repeat(201), undefined],
    ["a non-string query", 42, undefined],
    ["a short session", "storgata", "short"],
    ["a session with other characters", "storgata", "abc def ghi"],
    ["an over-long session", "storgata", "s".repeat(65)],
    ["a blank session", "storgata", ""],
  ])("refuses %s before sending anything", async (_label, query, session) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().delivery.addresses.suggest(query as string, { session }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a 200-character query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok([]));
    await expect(medal().delivery.addresses.suggest("x".repeat(200))).resolves.toEqual({
      data: [],
    });
  });

  it("maps 429 RATE_LIMITED to a MedalApiError after the usual retries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => apiError(429, "RATE_LIMITED", "Too many address lookups."));

    const err = await failure(medal().delivery.addresses.suggest("storgata"));

    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("delivery.addresses.resolve", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs the id and session as JSON and returns the verified address", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/delivery/addresses/resolve");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(init?.body as string)).toEqual({ id: "kv_1", session: SESSION });
      return ok(ADDRESS);
    });

    const result = await medal().delivery.addresses.resolve("kv_1", { session: SESSION });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: ADDRESS });
  });

  it("sends only the id, unchanged, when there is no session", async () => {
    const id = `g_${"a".repeat(317)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toEqual({ id });
      return ok({ ...ADDRESS, source: "google" });
    });

    const { data } = await medal().delivery.addresses.resolve(id);

    expect(data.source).toBe("google");
  });

  it("maps 422 ADDRESS_NOT_VERIFIED without retrying", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(apiError(422, "ADDRESS_NOT_VERIFIED", "The address needs a house number"));

    const err = await failure(medal().delivery.addresses.resolve("kv_1"));

    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("ADDRESS_NOT_VERIFIED");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("retries a 503 ADDRESS_LOOKUP_UNAVAILABLE, then surfaces it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        apiError(503, "ADDRESS_LOOKUP_UNAVAILABLE", "Address lookup is unavailable"),
      );

    const err = await failure(medal().delivery.addresses.resolve("kv_1"));

    expect(err.status).toBe(503);
    expect(err.code).toBe("ADDRESS_LOOKUP_UNAVAILABLE");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each<[string, unknown, string | undefined]>([
    ["a blank id", "   ", undefined],
    ["an empty id", "", undefined],
    ["an over-long id", "x".repeat(321), undefined],
    ["a non-string id", undefined, undefined],
    ["a malformed session", "kv_1", "bad session!"],
  ])("refuses %s before sending anything", async (_label, id, session) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().delivery.addresses.resolve(id as string, { session }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("delivery.quotes.create", () => {
  beforeEach(() => vi.restoreAllMocks());

  const INPUT: DeliveryQuoteInput = {
    address_id: "addr_1",
    venue_id: "venue_1",
    bags: 2,
    prep_minutes: 20,
    order_total: 31800,
  };

  it("POSTs the input as JSON and returns the 201 quote", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/delivery/quotes");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).has("idempotency-key")).toBe(false);
      expect(JSON.parse(init?.body as string)).toEqual(INPUT);
      return ok(QUOTE, 201);
    });

    const result = await medal().delivery.quotes.create(INPUT, { signal: controller.signal });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: QUOTE });
  });

  it("sends just the address when that is all there is, and reads a null fee", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toEqual({ address_id: "addr_1" });
      return ok(
        { ...QUOTE, customer_fee: null, cost: null, eta_minutes: null, delivered_by: null },
        201,
      );
    });

    const { data } = await medal().delivery.quotes.create({ address_id: "addr_1" });

    expect(data.customer_fee).toBeNull();
    expect(data.delivered_by).toBeNull();
  });

  it.each<[number, MedalErrorCode]>([
    [429, "RATE_LIMITED"],
    [503, "INTERNAL_ERROR"],
    [504, "QUOTE_TIMEOUT"],
  ])("sends a quote exactly once, even on %i %s", async (status, code) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => apiError(status, code, "nope"));

    const err = await failure(medal().delivery.quotes.create({ address_id: "addr_1" }));

    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it.each<[number, MedalErrorCode]>([
    [400, "INVALID_REQUEST"],
    [409, "DELIVERY_NOT_SET_UP"],
    [409, "DELIVERY_PAUSED"],
    [409, "VENUE_UNAVAILABLE"],
    [422, "ADDRESS_NOT_VERIFIED"],
    [422, "NOT_DELIVERABLE"],
    [422, "ADDRESS_NOT_DELIVERABLE"],
  ])("maps %i %s to a MedalApiError", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code, "Refused"));

    const err = await failure(medal().delivery.quotes.create(INPUT));

    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
  });

  it.each<[string, unknown]>([
    ["a missing input", undefined],
    ["a missing address_id", {}],
    ["a blank address_id", { address_id: "  " }],
    ["an over-long address_id", { address_id: "a".repeat(65) }],
    ["a blank venue_id", { address_id: "addr_1", venue_id: "" }],
    ["an over-long venue_id", { address_id: "addr_1", venue_id: "v".repeat(65) }],
    ["zero bags", { address_id: "addr_1", bags: 0 }],
    ["21 bags", { address_id: "addr_1", bags: 21 }],
    ["fractional bags", { address_id: "addr_1", bags: 1.5 }],
    ["negative prep_minutes", { address_id: "addr_1", prep_minutes: -1 }],
    ["prep_minutes over 60", { address_id: "addr_1", prep_minutes: 61 }],
    ["a string order_total", { address_id: "addr_1", order_total: "31800" }],
    ["a negative order_total", { address_id: "addr_1", order_total: -1 }],
    ["an order_total over the cap", { address_id: "addr_1", order_total: 100_000_001 }],
  ])("refuses %s before sending anything", async (_label, input) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().delivery.quotes.create(input as DeliveryQuoteInput),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the edges of every range", async () => {
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string));
      return ok(QUOTE, 201);
    });
    const low = { address_id: "a", bags: 1, prep_minutes: 0, order_total: 0 };
    const high = {
      address_id: "a".repeat(64),
      venue_id: "v".repeat(64),
      bags: 20,
      prep_minutes: 60,
      order_total: 100_000_000,
    };

    await medal().delivery.quotes.create(low);
    await medal().delivery.quotes.create(high);

    expect(bodies).toEqual([low, high]);
  });
});

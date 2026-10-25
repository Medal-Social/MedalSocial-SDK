import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Medal,
  MedalApiError,
  type OrderingChannel,
  type OrderingLocations,
  type OrderingSlots,
} from "../src";

const BASE = "https://test.convex.site";

const LOCATIONS: OrderingLocations = {
  time_zone: "Europe/Oslo",
  locations: [
    {
      id: "loc_1",
      name: "Sentrum",
      address: {
        lines: ["Storgata 1"],
        locality: "Oslo",
        postal_code: "0155",
        region_code: "NO",
      },
      channels: {
        dine_in: {
          enabled: true,
          open: true,
          closes_at: "2026-10-21T20:00:00.000Z",
          last_order_at: "2026-10-21T19:30:00.000Z",
        },
        takeaway: {
          enabled: true,
          open: false,
          reason: "paused",
          opens_at: "2026-10-21T13:00:00.000Z",
        },
        delivery: { enabled: false, open: false, reason: "delivery_off" },
      },
      payment_methods: { vipps: true, pay_at_counter: false },
      preorder_days: 3,
      slot_minutes: 15,
    },
  ],
};

const SLOTS: OrderingSlots = {
  location_id: "loc_1",
  channel: "takeaway",
  date: "2026-10-21",
  time_zone: "Europe/Oslo",
  slots: [
    { start: "2026-10-21T14:00:00.000Z", end: "2026-10-21T14:15:00.000Z" },
    { start: "2026-10-21T14:15:00.000Z", end: "2026-10-21T14:30:00.000Z" },
  ],
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

function apiError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_1" },
  });
}

function medal() {
  return new Medal("medal_test", { baseUrl: BASE });
}

describe("ordering.locations", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs /api/v1/ordering/locations with no query, authenticated, and returns the envelope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/ordering/locations");
      expect([...parsed.searchParams.keys()]).toEqual([]);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer medal_test");
      return ok(LOCATIONS);
    });

    const result = await medal().ordering.locations();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: LOCATIONS });
    // snake_case passes through unchanged, optional fields stay omitted
    const channels = result.data.locations[0].channels;
    expect(channels.takeaway.reason).toBe("paused");
    expect("reason" in channels.dine_in).toBe(false);
  });

  it("maps 403 ORDERING_NOT_ENABLED to MedalApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiError(403, "ORDERING_NOT_ENABLED", "Online ordering is not enabled for this workspace"),
    );
    const err = (await medal()
      .ordering.locations()
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
    await expect(medal().ordering.locations({ signal: controller.signal })).rejects.toThrow("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ordering.slots", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs /api/v1/ordering/slots with location, channel and date", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/ordering/slots");
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        location: "loc_1",
        channel: "takeaway",
        date: "2026-10-21",
      });
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer medal_test");
      return ok(SLOTS);
    });

    const result = await medal().ordering.slots({
      location: "loc_1",
      channel: "takeaway",
      date: "2026-10-21",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: SLOTS });
  });

  it("trims location and date before sending", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.searchParams.get("location")).toBe("loc_1");
      expect(parsed.searchParams.get("date")).toBe("2026-10-22");
      return ok({ ...SLOTS, date: "2026-10-22", slots: [] });
    });
    const result = await medal().ordering.slots({
      location: " loc_1 ",
      channel: "delivery",
      date: " 2026-10-22 ",
    });
    expect(result.data.slots).toEqual([]);
  });

  it.each([
    { location: "", channel: "takeaway", date: "2026-10-21" },
    { location: "   ", channel: "takeaway", date: "2026-10-21" },
    { location: "x".repeat(65), channel: "takeaway", date: "2026-10-21" },
    { location: "loc_1", channel: "dineIn", date: "2026-10-21" },
    { location: "loc_1", channel: "pickup", date: "2026-10-21" },
    { location: "loc_1", channel: "takeaway", date: "21.10.2026" },
    { location: "loc_1", channel: "takeaway", date: "2026-02-31" },
    { location: "loc_1", channel: "takeaway", date: "2026-10-21T12:00:00Z" },
  ])("refuses %o before sending anything", async (input) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.slots({ ...input, channel: input.channel as OrderingChannel }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [400, "VALIDATION_ERROR", "date must be from 2026-10-21 to 2026-10-24"],
    [403, "ORDERING_NOT_ENABLED", "Online ordering is not enabled for this workspace"],
    [404, "NOT_FOUND", "Ordering location not found"],
  ])("maps %i %s to MedalApiError", async (status, code, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code, message));
    const err = (await medal()
      .ordering.slots({ location: "loc_1", channel: "dine_in", date: "2026-10-30" })
      .catch((e: unknown) => e)) as MedalApiError;
    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toContain(message);
  });

  it("passes the caller's AbortSignal through", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.slots(
        { location: "loc_1", channel: "takeaway", date: "2026-10-21" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalBooking, PortalPerson, PortalProfile } from "../src";
import { Medal, MedalApiError } from "../src";

const BASE = "https://test.convex.site";
const SESSION = "sess_1";

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

const emma: PortalPerson = {
  person_id: "p_1",
  name: "Emma",
  birth_year: 2019,
  birth_month: 5,
  relation_type: "guardian",
  relation_label: null,
  notes: "Redd for saksen",
  preferred_resource_id: "r_1",
  active: true,
};

describe("portal.persons.create (SP10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts the person with the session header and no idempotency key", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/me/persons`);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-portal-session")).toBe(SESSION);
      expect(headers.get("idempotency-key")).toBeNull();
      expect(JSON.parse(init?.body as string)).toEqual({
        name: "Emma",
        birth_year: 2019,
        birth_month: 5,
        notes: "Redd for saksen",
        preferred_resource_id: "r_1",
      });
      return mockJson({ data: emma }, 201);
    });

    const { data } = await medal().portal.persons.create(SESSION, {
      name: "Emma",
      birth_year: 2019,
      birth_month: 5,
      notes: "Redd for saksen",
      preferred_resource_id: "r_1",
    });
    expect(data).toEqual(emma);
  });

  it("is sent exactly once — a retry would meet the person it created and answer 409", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 503, statusText: "Error" }));

    await expect(
      medal().portal.persons.create(SESSION, { name: "Emma", birth_year: 2019 }),
    ).rejects.toBeInstanceOf(MedalApiError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces a duplicate as 409 CONFLICT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ error: { code: "CONFLICT", message: "Already registered" } }, 409),
    );

    const err = await medal()
      .portal.persons.create(SESSION, { name: "Emma", birth_year: 2019 })
      .catch((e: unknown) => e);
    expect((err as MedalApiError).status).toBe(409);
    expect((err as MedalApiError).code).toBe("CONFLICT");
  });
});

describe("portal.persons.update (SP10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("patches one person by id, encoding the id and sending nulls to clear", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/me/persons/p%2F1`);
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("x-portal-session")).toBe(SESSION);
      expect(JSON.parse(init?.body as string)).toEqual({
        name: "Emma K.",
        birth_month: null,
        notes: null,
        preferred_resource_id: null,
      });
      return mockJson({
        data: {
          ...emma,
          name: "Emma K.",
          birth_month: null,
          notes: null,
          preferred_resource_id: null,
        },
      });
    });

    const { data } = await medal().portal.persons.update(SESSION, "p/1", {
      name: "Emma K.",
      birth_month: null,
      notes: null,
      preferred_resource_id: null,
    });
    expect(data.person_id).toBe("p_1");
    expect(data.birth_month).toBeNull();
  });

  it("retries a transient 503 — re-applying the same patch reaches the same state", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 503, statusText: "Error" }))
      .mockResolvedValueOnce(mockJson({ data: emma }));

    const { data } = await medal().portal.persons.update(SESSION, "p_1", { name: "Emma" });
    expect(data).toEqual(emma);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("portal.persons.remove (SP10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deletes by id and resolves to undefined on a 204", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/me/persons/p_1`);
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("x-portal-session")).toBe(SESSION);
      return new Response(null, { status: 204 });
    });

    await expect(medal().portal.persons.remove(SESSION, "p_1")).resolves.toBeUndefined();
  });

  it("is sent exactly once — a removed person is unreachable, so a retry would 404", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 503, statusText: "Error" }));

    await expect(medal().portal.persons.remove(SESSION, "p_1")).rejects.toBeInstanceOf(
      MedalApiError,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("portal.session(token) person helpers (SP10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards createPerson / updatePerson / removePerson with the bound token", async () => {
    const seen: { method: string; path: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new Headers(init?.headers).get("x-portal-session")).toBe("ps_token");
      seen.push({ method: init?.method as string, path: new URL(url as string).pathname });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return mockJson({ data: emma }, init?.method === "POST" ? 201 : 200);
    });

    const me = medal().portal.session("ps_token");
    await me.createPerson({ name: "Emma", birth_year: 2019 });
    await me.updatePerson("p_1", { birth_month: 6 });
    await me.removePerson("p_1");

    expect(seen).toEqual([
      { method: "POST", path: "/api/v1/portal/me/persons" },
      { method: "PATCH", path: "/api/v1/portal/me/persons/p_1" },
      { method: "DELETE", path: "/api/v1/portal/me/persons/p_1" },
    ]);
  });
});

describe("SP10 read shapes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("types family entries with person_id / birth_month, and lets a client echo them back", async () => {
    const profile: PortalProfile = {
      contact_id: "c_1",
      email: "ida@example.com",
      first_name: "Ida",
      last_name: null,
      phone: null,
      family: [{ person_id: "p_1", name: "Emma", birth_year: 2019, birth_month: 5 }],
      persons: [emma],
      labels: { person: "Barn", persons: "Barn" },
      marketing_consent: false,
      created_at: 1_700_000_000_000,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") {
        expect(JSON.parse(init.body as string)).toEqual({ family: profile.family });
      }
      return mockJson({ data: profile });
    });

    const { data } = await medal().portal.me(SESSION);
    expect(data.family[0]?.person_id).toBe("p_1");
    expect(data.persons[0]?.preferred_resource_id).toBe("r_1");
    // Echoing the read back type-checks: the write shape accepts (and the API ignores) both.
    await medal().portal.updateMe(SESSION, { family: data.family });
  });

  it("carries booked_for_person_id and the birth year/month on portal bookings", async () => {
    const booking: PortalBooking = {
      booking_id: "b_1",
      status: "confirmed",
      start_ts: 1_790_000_000_000,
      end_ts: 1_790_001_800_000,
      start_ts_iso: "2026-09-21T12:53:20.000Z",
      end_ts_iso: "2026-09-21T13:23:20.000Z",
      service_id: "s_1",
      service_name: "Barneklipp",
      resource_id: "r_1",
      resource_name: "Kari",
      booked_for_name: "Emma",
      booked_for_person_id: "p_1",
      booked_for_birth_year: 2019,
      booked_for_birth_month: 5,
      amount_ore: 35_000,
      payment_mode: "none",
      payment_status: "none",
      notes: null,
      manage_token: null,
      can_manage: false,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ data: { upcoming: [booking], past: [] } }),
    );

    const { data } = await medal().portal.myBookings(SESSION);
    expect(data.upcoming[0]?.booked_for_person_id).toBe("p_1");
    expect(data.upcoming[0]?.booked_for_birth_month).toBe(5);
  });
});

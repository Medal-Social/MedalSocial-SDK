import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookingEventRegistration,
  BookingEventRegistrationResult,
  ListBookingEventRegistrationsResult,
  RegisterBookingEventChildInput,
  RegisterBookingEventGuardianInput,
  RegisterBookingEventInput,
} from "../src";
import { Medal } from "../src";
import { MedalApiError } from "../src/types/common";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

const BOOKING = {
  id: "bk_9",
  contact_id: "c1",
  service_id: "svc_1",
  resource_id: null,
  start_ts: null,
  end_ts: null,
  booked_for_name: "Nora",
  booked_for_birth_year: 2020,
  booked_for_person_id: null,
  event_id: "e1",
  event_order: 3,
  party_sequence_id: null,
  status: "confirmed",
  cancelled_by: null,
  cancel_reason: null,
  rescheduled_from_id: null,
  payment_status: "reserved",
  payment_mode: "reserve",
  amount_ore: 39_000,
  notes: null,
  internal_notes: null,
  created_via: "api",
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
};

const REGISTER_INPUT: RegisterBookingEventInput = {
  guardian: { name: "Kari Hansen", email: "kari@example.no", phone: "+4790000000" },
  child: { name: "Nora", birth_year: 2020 },
  service_id: "svc_1",
  consent_accepted: true,
  consent_version: "2026-09",
  consent_text: "Jeg godtar vilkårene for barnehageklipp.",
  return_url: "https://coolkids.no/retur",
};

describe("bookings.events.register (SP10a)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("registers a child under a minted Idempotency-Key, with a payment", async () => {
    let sentKey: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).toBe(`${BASE}/api/v1/bookings/events/e1/registrations`);
      expect(init?.method).toBe("POST");
      sentKey = new Headers(init?.headers).get("idempotency-key");
      expect(JSON.parse(String(init?.body))).toEqual(REGISTER_INPUT);
      return mockJson(
        {
          data: {
            booking: BOOKING,
            manage_token: "mtok_1",
            contact_id: "c1",
            person_id: "pn_1",
            payment: {
              reference: "mb-e1-1",
              redirect_url: "https://vipps.test/redirect/mb-e1-1",
              state: "created",
            },
          },
        },
        201,
      );
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.register("e1", REGISTER_INPUT);

    expect(data.booking.id).toBe("bk_9");
    expect(data.booking.event_id).toBe("e1");
    expect(data.booking.event_order).toBe(3);
    expect(data.booking.payment_mode).toBe("reserve");
    expect(data.manage_token).toBe("mtok_1");
    expect(data.contact_id).toBe("c1");
    expect(data.person_id).toBe("pn_1");
    expect(data.payment?.redirect_url).toBe("https://vipps.test/redirect/mb-e1-1");
    expect(sentKey).toBeTruthy();
  });

  it("returns payment: null when the service needs no payment", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson(
        {
          data: {
            booking: { ...BOOKING, payment_mode: "none" },
            contact_id: "c1",
            person_id: "pn_1",
            payment: null,
          },
        },
        201,
      ),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.register("e1", REGISTER_INPUT);

    expect(data.payment).toBeNull();
    expect(data.manage_token).toBeUndefined();
  });

  it("surfaces a payment_error alongside the still-created booking", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson(
        {
          data: {
            booking: BOOKING,
            contact_id: "c1",
            person_id: "pn_1",
            payment: null,
            payment_error: { code: "WALLET_REFUSED", message: "Vipps declined the reservation" },
          },
        },
        201,
      ),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.register("e1", REGISTER_INPUT);

    expect(data.payment).toBeNull();
    expect(data.payment_error).toEqual({
      code: "WALLET_REFUSED",
      message: "Vipps declined the reservation",
    });
  });

  it("honours a caller-supplied idempotency key", async () => {
    let sentKey: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      sentKey = new Headers(init?.headers).get("idempotency-key");
      return mockJson(
        { data: { booking: BOOKING, contact_id: "c1", person_id: "pn_1", payment: null } },
        201,
      );
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.bookings.events.register("e1", REGISTER_INPUT, { idempotencyKey: "idem_reg_1" });

    expect(sentKey).toBe("idem_reg_1");
  });

  it("url-encodes the event id", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return mockJson(
        { data: { booking: BOOKING, contact_id: "c1", person_id: "pn_1", payment: null } },
        201,
      );
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.bookings.events.register("e 1", REGISTER_INPUT);

    expect(urls).toEqual([`${BASE}/api/v1/bookings/events/e%201/registrations`]);
  });

  it("surfaces the 404 an unknown arrangement answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "NOT_FOUND", message: "Event not found" } }, 404),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.bookings.events.register("e1", REGISTER_INPUT)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(medal.bookings.events.register("e1", REGISTER_INPUT)).rejects.toBeInstanceOf(
      MedalApiError,
    );
  });

  it("surfaces the 409 a full or closed arrangement answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "CONFLICT", message: "Arrangement is full" } }, 409),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.bookings.events.register("e1", REGISTER_INPUT)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("surfaces the 422 a return_url this workspace does not vouch for answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson(
        { error: { code: "UNPROCESSABLE_ENTITY", message: "Unrecognized return_url" } },
        422,
      ),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.bookings.events.register("e1", REGISTER_INPUT)).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    });
  });

  it("exports the registration types from the package root", () => {
    // Compile-time guard: these types must be importable from "../src" (the
    // package's public entry) so consumers can name them without reaching
    // into "../src/types/bookings" directly. A regression here fails
    // typecheck with TS2305, not this assertion.
    const guardian: RegisterBookingEventGuardianInput = { name: "Kari Hansen" };
    const child: RegisterBookingEventChildInput = { name: "Nora", birth_year: 2020 };
    const input: RegisterBookingEventInput = {
      guardian,
      child,
      service_id: "svc_1",
      consent_accepted: true,
    };
    const result: BookingEventRegistrationResult = {
      booking: BOOKING as unknown as BookingEventRegistrationResult["booking"],
      contact_id: "c1",
      person_id: "pn_1",
      payment: null,
    };

    expect(guardian.name).toBe("Kari Hansen");
    expect(child.birth_year).toBe(2020);
    expect(input.consent_accepted).toBe(true);
    expect(result.payment).toBeNull();
  });
});

const REGISTRATION_ROW: BookingEventRegistration = {
  booking_id: "bk_9",
  event_order: 3,
  contact_id: "c1",
  contact_name: "Kari Hansen",
  person_id: "pn_1",
  participant_name: "Nora",
  participant_birth_year: 2020,
  service_id: "svc_1",
  resource_id: "res_1",
  start_ts: "2026-10-15T07:00:00.000Z",
  status: "confirmed",
  amount_ore: 39_000,
  payment_status: "reserved",
};

describe("bookings.events.registrations (SP10a roster)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists an arrangement's roster ordered by event_order", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).toBe(`${BASE}/api/v1/bookings/events/e1/registrations`);
      expect(init?.method).toBe("GET");
      const body: { data: ListBookingEventRegistrationsResult } = {
        data: { registrations: [REGISTRATION_ROW], truncated: false },
      };
      return mockJson(body);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.registrations("e1");

    expect(data.registrations).toHaveLength(1);
    expect(data.registrations[0]).toEqual(REGISTRATION_ROW);
    expect(data.truncated).toBe(false);
  });

  it("returns an empty roster for an arrangement with no registrations", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { registrations: [], truncated: false } }),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.registrations("e1");

    expect(data.registrations).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it("surfaces truncated: true when the roster is capped at 300 rows", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { registrations: [REGISTRATION_ROW], truncated: true } }),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.events.registrations("e1");

    expect(data.truncated).toBe(true);
  });

  it("url-encodes the event id", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return mockJson({ data: { registrations: [], truncated: false } });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.bookings.events.registrations("e 1");

    expect(urls).toEqual([`${BASE}/api/v1/bookings/events/e%201/registrations`]);
  });

  it("surfaces the 404 an unknown or cross-workspace arrangement answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "NOT_FOUND", message: "Event not found" } }, 404),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.bookings.events.registrations("e1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(medal.bookings.events.registrations("e1")).rejects.toBeInstanceOf(MedalApiError);
  });
});

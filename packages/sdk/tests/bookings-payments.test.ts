import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookingPayment,
  BookingPaymentMode,
  BookingPaymentStart,
  BookingPaymentState,
  StartBookingPaymentInput,
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

const START_RESULT = {
  reference: "mb-338039-abc-1",
  redirect_url: "https://vipps.test/redirect/mb-338039-abc-1",
  state: "created",
};

const PAYMENT = {
  reference: "mb-338039-abc-1",
  provider: "vipps",
  state: "authorized",
  mode: "reserve",
  attempt: 1,
  amount_ore: 39_000,
  authorized_ore: 39_000,
  captured_ore: 0,
  refunded_ore: 0,
  cancelled_ore: 0,
  currency: "NOK",
  capture_guaranteed_until: "2026-09-16T00:00:00.000Z",
  terms_version: "v1",
  terms_accepted_at: "2026-09-09T00:00:00.000Z",
  failure_code: null,
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:01.000Z",
};

describe("bookings.payment (SP8b)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts a payment on the booking-id route under a minted Idempotency-Key", async () => {
    let sentKey: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).toBe(`${BASE}/api/v1/bookings/bk_1/payment`);
      expect(init?.method).toBe("POST");
      // postOnce mints the key so an SDK retry cannot reserve twice.
      sentKey = new Headers(init?.headers).get("idempotency-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        return_url: "https://coolkids.no/retur",
        terms_accepted: true,
        terms_version: "2026-09",
      });
      return mockJson({ data: START_RESULT });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.payment.start("bk_1", {
      return_url: "https://coolkids.no/retur",
      terms_accepted: true,
      terms_version: "2026-09",
    });

    expect(data.reference).toBe("mb-338039-abc-1");
    expect(data.redirect_url).toBe("https://vipps.test/redirect/mb-338039-abc-1");
    expect(data.state).toBe("created");
    expect(sentKey).toBeTruthy();
  });

  it("honours a caller-supplied idempotency key", async () => {
    let sentKey: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      sentKey = new Headers(init?.headers).get("idempotency-key");
      return mockJson({ data: START_RESULT });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.bookings.payment.start(
      "bk_1",
      { return_url: "https://coolkids.no/retur", terms_accepted: true },
      { idempotencyKey: "idem_pay_1" },
    );

    expect(sentKey).toBe("idem_pay_1");
  });

  it("reads the newest attempt back, without a redirect url", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe(`${BASE}/api/v1/bookings/bk_1/payment`);
      expect(init?.method).toBe("GET");
      return mockJson({ data: PAYMENT });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.bookings.payment.get("bk_1");

    expect(data.state).toBe("authorized");
    expect(data.mode).toBe("reserve");
    expect(data.amount_ore).toBe(39_000);
    expect(data.captured_ore).toBe(0);
    expect(data.currency).toBe("NOK");
    expect("redirect_url" in data).toBe(false);
  });

  it("surfaces the 404 a booking with no payment answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "NOT_FOUND", message: "No payment on this booking" } }, 404),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.bookings.payment.get("bk_1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(medal.bookings.payment.get("bk_1")).rejects.toBeInstanceOf(MedalApiError);
  });

  it("surfaces the 409 a second live payment answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ error: { code: "CONFLICT", message: "A payment is already in flight" } }, 409),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(
      medal.bookings.payment.start("bk_1", {
        return_url: "https://coolkids.no/retur",
        terms_accepted: true,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("uses the manage-token routes, url-encoding the token", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      urls.push(String(input));
      return mockJson({ data: init?.method === "POST" ? START_RESULT : PAYMENT });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const started = await medal.bookings.manage.payment.start("tok 1", {
      return_url: "https://coolkids.no/retur",
      terms_accepted: true,
      terms_text: "Avbestilling senest 24 timer før.",
    });
    const read = await medal.bookings.manage.payment.get("tok 1");

    expect(started.data.state).toBe("created");
    expect(read.data.reference).toBe("mb-338039-abc-1");
    expect(urls).toEqual([
      `${BASE}/api/v1/bookings/manage/tok%201/payment`,
      `${BASE}/api/v1/bookings/manage/tok%201/payment`,
    ]);
  });

  it("exports the payment types from the package root", () => {
    // Compile-time guard: these types must be importable from "../src" (the
    // package's public entry) so consumers can name them without reaching
    // into "../src/types/bookings" directly. A regression here fails
    // typecheck with TS2305, not this assertion.
    const mode: BookingPaymentMode = "reserve";
    const state: BookingPaymentState = "authorized";
    const start: BookingPaymentStart = {
      reference: "mb-1",
      redirect_url: "https://vipps.test/redirect/mb-1",
      state: "created",
    };
    const payment: BookingPayment = {
      reference: "mb-1",
      provider: "vipps",
      state: "authorized",
      mode: "reserve",
      attempt: 1,
      amount_ore: 39_000,
      authorized_ore: 39_000,
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
    };
    const input: StartBookingPaymentInput = {
      return_url: "https://coolkids.no/retur",
      terms_accepted: true,
    };

    expect(mode).toBe("reserve");
    expect(state).toBe("authorized");
    expect(start.state).toBe("created");
    expect(payment.mode).toBe("reserve");
    expect(input.terms_accepted).toBe(true);
  });
});

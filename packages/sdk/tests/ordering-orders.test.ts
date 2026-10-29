import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isOrderingRefusal,
  Medal,
  MedalApiError,
  type OrderingCreateOrderInput,
  type OrderingCustomerOrder,
  type OrderingOrderCreated,
  type OrderingOrderStatusView,
  type OrderingRefusalCode,
  type OrderingTable,
} from "../src";

const BASE = "https://test.convex.site";

const ORDER_INPUT: OrderingCreateOrderInput = {
  location_id: "loc_1",
  channel: "takeaway",
  lines: [
    { product_id: "p_1", quantity: 2, option_ids: ["o_1", "o_2"], note: "Extra crispy" },
    { product_id: "p_2", quantity: 1 },
  ],
  customer: { name: "Guest", phone: "+4791234567", email: "guest@example.com" },
  preferences: { cutlery: true, allergy_note: "No peanuts" },
  payment_method: "pay_at_counter",
};

const CREATED: OrderingOrderCreated = {
  order_id: "ord_1",
  order_number: "P-1022-004",
  status: "placed",
};

const ORDER: OrderingCustomerOrder = {
  order_id: "ord_1",
  order_number: "P-1022-004",
  status: "accepted",
  channel: "dine_in",
  table_label: "12",
  timing: { kind: "asap" },
  lines: [
    {
      name: "Burger",
      quantity: 2,
      options: [{ name: "Cheese" }],
      unit_price_ore: 15900,
      line_total_ore: 31800,
    },
  ],
  subtotal_ore: 31800,
  total_ore: 31800,
  vat_breakdown: [{ rate_bp: 2500, net_ore: 25440, vat_ore: 6360 }],
  payment: { method: "pay_at_counter", state: "none" },
  ready_at: "2026-10-22T16:30:00.000Z",
  created_at: "2026-10-22T16:00:00.000Z",
  updated_at: "2026-10-22T16:05:00.000Z",
};

const STATUS: OrderingOrderStatusView = {
  order_id: "ord_1",
  order_number: "P-1022-004",
  status: "declined",
  payment: { method: "pay_at_counter", state: "none" },
  decline_reason: "too_busy",
  updated_at: "2026-10-22T16:05:00.000Z",
  timeline: [
    { status: "placed", at: "2026-10-22T16:00:00.000Z" },
    { status: "declined", at: "2026-10-22T16:05:00.000Z" },
  ],
};

const TABLE: OrderingTable = { location_id: "loc_1", table_label: "12" };

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

function apiError(status: number, code: string, message: string, details?: unknown) {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
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

describe("ordering.orders.create", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs the body as JSON with Idempotency-Key and X-Medal-Client-Ip, and returns the envelope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/ordering/orders");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("idempotency-key")).toBe("cart_key_1");
      expect(headers.get("x-medal-client-ip")).toBe("203.0.113.7");
      expect(JSON.parse(init?.body as string)).toEqual(ORDER_INPUT);
      return ok(CREATED, 201);
    });

    const result = await medal().ordering.orders.create(ORDER_INPUT, {
      idempotencyKey: " cart_key_1 ",
      clientIp: " 203.0.113.7 ",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: CREATED });
  });

  it("leaves optional fields out of the body and sends no client IP when none or blank is given", async () => {
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("x-medal-client-ip")).toBe(false);
      bodies.push(JSON.parse(init?.body as string));
      return ok(CREATED);
    });
    const input: OrderingCreateOrderInput = {
      location_id: "loc_1",
      channel: "dine_in",
      table_token: "tbl_abc",
      timing: { kind: "asap" },
      lines: [{ product_id: "p_1", quantity: 1 }],
      customer: { name: "Guest", phone: "91234567" },
      preferences: { cutlery: false, no_contact: true },
      payment_method: "pay_at_counter",
    };

    await medal().ordering.orders.create(input, { idempotencyKey: "k1" });
    await medal().ordering.orders.create(input, { idempotencyKey: "k1", clientIp: "  " });

    expect(bodies).toEqual([input, input]);
    expect(JSON.stringify(bodies[0])).not.toContain("null");
  });

  it("retries a 503 under the SAME Idempotency-Key, so the order is placed once", async () => {
    const keys: (string | null)[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      return keys.length === 1 ? apiError(503, "INTERNAL_ERROR", "unavailable") : ok(CREATED);
    });

    const result = await medal().ordering.orders.create(ORDER_INPUT, { idempotencyKey: "k_retry" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(keys).toEqual(["k_retry", "k_retry"]);
    expect(result.data.order_id).toBe("ord_1");
  });

  it.each([[""], ["   "], ["k".repeat(256)], [undefined]])(
    "refuses idempotencyKey %j before sending anything",
    async (idempotencyKey) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(
        medal().ordering.orders.create(ORDER_INPUT, {
          idempotencyKey: idempotencyKey as string,
        }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing options object before sending anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.orders.create(
        ORDER_INPUT,
        undefined as unknown as { idempotencyKey: string },
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each<[OrderingRefusalCode, Record<string, unknown> | undefined]>([
    ["CLOSED", { reason: "paused" }],
    ["CUTOFF", undefined],
    ["CHANNEL_NOT_AVAILABLE", {}],
    ["PREORDER_DISABLED", {}],
    ["TABLE_NOT_FOUND", {}],
    ["SOLD_OUT", { ids: ["p_1", "o_2"] }],
    ["UNAVAILABLE", { ids: ["p_2"] }],
    ["INVALID_OPTIONS", { line_index: 0 }],
    ["INVALID_CART", { line_index: 1 }],
    ["PAYMENT_METHOD_NOT_ALLOWED", {}],
    ["INVALID_CUSTOMER", { reason: "phone" }],
  ])("maps 422 %s to a MedalApiError with its details", async (code, details) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(422, code, "Refused", details));

    const err = await failure(medal().ordering.orders.create(ORDER_INPUT, { idempotencyKey: "k" }));

    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe(code);
    expect(err.details).toEqual(details);
    expect(err.requestId).toBe("req_1");
    expect(isOrderingRefusal(err)).toBe(true);
  });

  it("narrows a refusal's code and snake_case details with isOrderingRefusal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiError(422, "SOLD_OUT", "Sold out", { ids: ["p_1"] }),
    );
    const err: unknown = await medal()
      .ordering.orders.create(ORDER_INPUT, { idempotencyKey: "k" })
      .catch((e: unknown) => e);

    if (!isOrderingRefusal(err)) throw new Error("expected a refusal");
    // Typed access, no casts: `code` is the refusal union, `details` the contract.
    const ids: string[] | undefined = err.details?.ids;
    expect(err.code satisfies OrderingRefusalCode).toBe("SOLD_OUT");
    expect(ids).toEqual(["p_1"]);
    expect(err.details?.line_index).toBeUndefined();
  });

  it.each([
    ["a non-API error", new Error("boom")],
    ["a non-422 status", new MedalApiError(409, "IDEMPOTENCY_KEY_CONFLICT", "x")],
    ["an unknown 422 code", new MedalApiError(422, "VALIDATION_ERROR", "x")],
    ["array details", new MedalApiError(422, "SOLD_OUT", "x", ["p_1"])],
    ["null details", new MedalApiError(422, "SOLD_OUT", "x", null)],
    ["string details", new MedalApiError(422, "SOLD_OUT", "x", "p_1")],
    ["string ids", new MedalApiError(422, "SOLD_OUT", "x", { ids: "p_1" })],
    ["non-string id", new MedalApiError(422, "SOLD_OUT", "x", { ids: ["p_1", 2] })],
    ["fractional line_index", new MedalApiError(422, "INVALID_CART", "x", { line_index: 1.5 })],
    ["negative line_index", new MedalApiError(422, "INVALID_CART", "x", { line_index: -1 })],
    ["string line_index", new MedalApiError(422, "INVALID_OPTIONS", "x", { line_index: "0" })],
    ["non-string reason", new MedalApiError(422, "CLOSED", "x", { reason: 1 })],
    ["non-string status", new MedalApiError(422, "CLOSED", "x", { status: false })],
  ])("isOrderingRefusal is false for %s", (_label, error) => {
    expect(isOrderingRefusal(error)).toBe(false);
  });

  it.each([
    [400, "IDEMPOTENCY_KEY_REQUIRED"],
    [403, "ORDERING_NOT_ENABLED"],
    [404, "ORDERING_LOCATION_NOT_FOUND"],
    [409, "IDEMPOTENCY_KEY_CONFLICT"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [409, "IDEMPOTENCY_IN_PROGRESS"],
  ])("maps %i %s to MedalApiError", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code, "Nope"));
    const err = await failure(medal().ordering.orders.create(ORDER_INPUT, { idempotencyKey: "k" }));
    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(isOrderingRefusal(err)).toBe(false);
  });

  it("sends a Vipps order's return_url and returns where the customer pays", async () => {
    const vippsInput: OrderingCreateOrderInput = {
      ...ORDER_INPUT,
      payment_method: "vipps",
      return_url: "https://bistro.no/takk",
    };
    const awaiting: OrderingOrderCreated = {
      order_id: "ord_2",
      order_number: "P-1022-005",
      status: "awaiting_payment",
      payment: { method: "vipps", redirect_url: "https://pay.vipps.no/abc" },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toMatchObject({
        payment_method: "vipps",
        return_url: "https://bistro.no/takk",
      });
      return ok(awaiting, 201);
    });
    const result = await medal().ordering.orders.create(vippsInput, { idempotencyKey: "k2" });
    expect(result.data.payment?.redirect_url).toBe("https://pay.vipps.no/abc");
  });

  it("narrows the Vipps refusals PAYMENT_UNAVAILABLE and RETURN_URL_NOT_ALLOWED", async () => {
    for (const code of ["PAYMENT_UNAVAILABLE", "RETURN_URL_NOT_ALLOWED"] as const) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(apiError(422, code, "Refused"));
      const error = await failure(
        medal().ordering.orders.create(
          { ...ORDER_INPUT, payment_method: "vipps", return_url: "https://bistro.no/takk" },
          { idempotencyKey: `k-${code}` },
        ),
      );
      expect(isOrderingRefusal(error)).toBe(true);
      expect(error.code).toBe(code satisfies OrderingRefusalCode);
    }
  });

  it("sends a delivery order's address, quote and door details, and narrows the quote refusals", async () => {
    const deliveryInput: OrderingCreateOrderInput = {
      ...ORDER_INPUT,
      channel: "delivery",
      payment_method: "vipps",
      return_url: "https://bistro.no/takk",
      preferences: { cutlery: true, no_contact: true },
      delivery: {
        verified_address_id: "addr_1",
        quote_id: "quote_1",
        floor: "3",
        door_code: "1234",
        comment: "Ring på ved ankomst",
      },
    };
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toMatchObject({
        channel: "delivery",
        delivery: { verified_address_id: "addr_1", quote_id: "quote_1", door_code: "1234" },
      });
      return ok({ ...CREATED, status: "awaiting_payment" }, 201);
    });
    await medal().ordering.orders.create(deliveryInput, { idempotencyKey: "k-delivery" });
    for (const code of ["QUOTE_NOT_USABLE", "QUOTE_EXPIRED"] as const) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(apiError(422, code, "Refused"));
      const error = await failure(
        medal().ordering.orders.create(deliveryInput, { idempotencyKey: `k-${code}` }),
      );
      expect(isOrderingRefusal(error)).toBe(true);
      expect(error.code).toBe(code satisfies OrderingRefusalCode);
    }
  });

  it("types a delivery order as Vipps with delivery details, and delivery details as delivery only", () => {
    // @ts-expect-error: a delivery order needs `delivery`.
    const noDetails: OrderingCreateOrderInput = {
      ...ORDER_INPUT,
      channel: "delivery",
      payment_method: "vipps",
      return_url: "https://bistro.no/takk",
    };
    // @ts-expect-error: delivery is Vipps only.
    const atCounter: OrderingCreateOrderInput = {
      ...ORDER_INPUT,
      channel: "delivery",
      delivery: { verified_address_id: "a", quote_id: "q" },
    };
    // @ts-expect-error: `delivery` is for the delivery channel only.
    const takeaway: OrderingCreateOrderInput = {
      ...ORDER_INPUT,
      delivery: { verified_address_id: "a", quote_id: "q" },
    };
    expect([noDetails, atCounter, takeaway]).toHaveLength(3);
  });

  it("passes the caller's AbortSignal through", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.orders.create(ORDER_INPUT, {
        idempotencyKey: "k",
        signal: controller.signal,
      }),
    ).rejects.toThrow("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ordering.orders.get / status / cancel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs the customer view of an order", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/ordering/orders/ord_1");
      expect(init?.method).toBe("GET");
      return ok(ORDER);
    });
    const result = await medal().ordering.orders.get(" ord_1 ");
    expect(result).toEqual({ data: ORDER });
  });

  it("reads a delivery's fee and window", async () => {
    const delivery: OrderingOrderStatusView = {
      ...STATUS,
      status: "handed_over",
      customer_eta: { min: "2026-10-22T17:05:00.000Z", max: "2026-10-22T17:15:00.000Z" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(delivery));
    const result = await medal().ordering.orders.status("ord_1");
    expect(result.data.customer_eta?.max).toBe("2026-10-22T17:15:00.000Z");
  });

  it("GETs the status view of an order", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/ordering/orders/ord_1/status");
      expect(init?.method).toBe("GET");
      return ok(STATUS);
    });
    const result = await medal().ordering.orders.status("ord_1");
    expect(result.data.decline_reason).toBe("too_busy");
    expect("ready_at" in result.data).toBe(false);
  });

  it("POSTs a cancel with no body and returns the status view", async () => {
    const cancelled: OrderingOrderStatusView = { ...STATUS, status: "cancelled" };
    delete cancelled.decline_reason;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/ordering/orders/ord_1/cancel");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      return ok(cancelled);
    });
    const result = await medal().ordering.orders.cancel("ord_1");
    expect(result.data.status).toBe("cancelled");
  });

  it("maps 409 INVALID_TRANSITION with details.status on cancel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiError(409, "INVALID_TRANSITION", "Already accepted", { status: "accepted" }),
    );
    const err = await failure(medal().ordering.orders.cancel("ord_1"));
    expect(err.status).toBe(409);
    expect(err.code).toBe("INVALID_TRANSITION");
    expect(err.details).toEqual({ status: "accepted" });
  });

  it("URL-encodes the order id", async () => {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      paths.push(new URL(url as string).pathname);
      return ok(STATUS);
    });
    await medal().ordering.orders.get("a/b?c");
    await medal().ordering.orders.status("a/b?c");
    await medal().ordering.orders.cancel("a/b?c");
    expect(paths).toEqual([
      "/api/v1/ordering/orders/a%2Fb%3Fc",
      "/api/v1/ordering/orders/a%2Fb%3Fc/status",
      "/api/v1/ordering/orders/a%2Fb%3Fc/cancel",
    ]);
  });

  it.each([["get"], ["status"], ["cancel"]] as const)(
    "%s maps 404 ORDER_NOT_FOUND",
    async (method) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        apiError(404, "ORDER_NOT_FOUND", "Order not found"),
      );
      const err = await failure(medal().ordering.orders[method]("ord_x"));
      expect(err.status).toBe(404);
      expect(err.code).toBe("ORDER_NOT_FOUND");
    },
  );

  it.each([
    ["get", ""],
    ["status", "  "],
    ["cancel", "x".repeat(65)],
    ["get", undefined],
    ["get", "."],
    ["status", ".."],
    ["cancel", " .. "],
  ] as const)("%s refuses order id %j before sending anything", async (method, orderId) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      medal().ordering.orders[method](orderId as unknown as string),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the caller's AbortSignal through", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const orders = medal().ordering.orders;
    const opts = { signal: controller.signal };
    await expect(orders.get("ord_1", opts)).rejects.toThrow("gone");
    await expect(orders.status("ord_1", opts)).rejects.toThrow("gone");
    await expect(orders.cancel("ord_1", opts)).rejects.toThrow("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ordering.table", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GETs /api/v1/ordering/tables/{token} and returns the envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/ordering/tables/tbl_abc");
      expect([...parsed.searchParams.keys()]).toEqual([]);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer medal_test");
      return ok(TABLE);
    });
    const result = await medal().ordering.table(" tbl_abc ");
    expect(result).toEqual({ data: TABLE });
  });

  it("URL-encodes the token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/ordering/tables/a%2F..%2Fb%23c%20d");
      return ok(TABLE);
    });
    await medal().ordering.table("a/../b#c d");
  });

  it.each([
    [404, "TABLE_NOT_FOUND"],
    [403, "ORDERING_NOT_ENABLED"],
  ])("maps %i %s to MedalApiError", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiError(status, code, "Nope"));
    const err = await failure(medal().ordering.table("tbl_x"));
    expect(err).toBeInstanceOf(MedalApiError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
  });

  it.each([[""], ["   "], ["t".repeat(65)], ["."], [".."]])(
    "refuses token %j before sending anything",
    async (token) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(medal().ordering.table(token)).rejects.toBeInstanceOf(RangeError);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("passes the caller's AbortSignal through", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(medal().ordering.table("tbl_abc", { signal: controller.signal })).rejects.toThrow(
      "gone",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

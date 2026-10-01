import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedalErrorCode } from "../src";
import {
  BaseClient,
  backoffDelayMs,
  MedalApiError,
  MedalError,
  MedalNetworkError,
  MedalTimeoutError,
  parseRetryAfterMs,
} from "../src";

const BASE = "https://test.convex.site";

function client(timeout = 5000) {
  return new BaseClient({
    baseUrl: BASE,
    token: "medal_test",
    timeout,
    userAgent: "test-agent",
  });
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down" } }), {
    status,
    statusText: "Too Many Requests",
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("MedalApiError transport metadata (SDK-13)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("carries the X-Request-ID of the failing response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), {
        status: 404,
        headers: { "content-type": "application/json", "x-request-id": "req_abc123" },
      }),
    );

    const err = await client()
      .get("/api/v1/contacts/c1")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MedalApiError);
    expect((err as MedalApiError).requestId).toBe("req_abc123");
  });

  it("parses Retry-After seconds into retryAfterMs on a 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(429, { "retry-after": "42" }));

    const err = await client()
      .post("/api/v1/contacts", { email: "a@b.co" }, { retry: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MedalApiError);
    expect((err as MedalApiError).retryAfterMs).toBe(42_000);
    expect((err as MedalApiError).status).toBe(429);
  });

  it("leaves requestId and retryAfterMs null when the headers are absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = (await client()
      .get("/api/v1/contacts")
      .catch((e: unknown) => e)) as MedalApiError;

    expect(err.requestId).toBeNull();
    expect(err.retryAfterMs).toBeNull();
  });

  it("is a MedalError, so one catch clause covers every SDK failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 400, headers: { "content-type": "application/json" } }),
    );
    const err = await client()
      .get("/api/v1/contacts")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedalError);
  });
});

describe("MedalErrorCode (SDK-26)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("narrows a documented code without rejecting an undocumented one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "IDEMPOTENCY_IN_PROGRESS", message: "in flight" } }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    const err = (await client()
      .post("/api/v1/bookings", {}, { retry: false })
      .catch((e: unknown) => e)) as MedalApiError;

    // A documented code, compared against the union member.
    const known: MedalErrorCode = "IDEMPOTENCY_IN_PROGRESS";
    expect(err.code).toBe(known);
    // And a code the server might add tomorrow still type-checks and arrives
    // intact — the union is widened with `string` on purpose.
    expect(new MedalApiError(400, "A_CODE_FROM_NEXT_WEEK", "x").code).toBe("A_CODE_FROM_NEXT_WEEK");
  });
});

describe("typed timeout and network failures (SDK-13)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws MedalTimeoutError with code TIMEOUT when the deadline elapses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        }),
    );

    const err = await client(10)
      .get("/api/v1/contacts")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MedalTimeoutError);
    expect(err).toBeInstanceOf(MedalError);
    expect((err as MedalTimeoutError).code).toBe("TIMEOUT");
    expect((err as MedalTimeoutError).timeoutMs).toBe(10);
  });

  it("wraps a fetch TypeError in MedalNetworkError and keeps the cause", async () => {
    const cause = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(cause);

    const err = await client()
      .post("/api/v1/gdpr/consent", {}, { retry: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MedalNetworkError);
    expect((err as MedalNetworkError).code).toBe("NETWORK");
    expect((err as MedalNetworkError).cause).toBe(cause);
  });
});

describe("caller AbortSignal (SDK-15)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("cancels an in-flight request and does not report it as a timeout", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
          setTimeout(() => controller.abort(), 5);
        }),
    );

    const err = await client()
      .get("/api/v1/contacts", undefined, { signal: controller.signal })
      .catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(MedalTimeoutError);
    expect((err as Error).name).toBe("AbortError");
  });

  it("refuses a request whose signal is already aborted, without calling fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const err = await client()
      .get("/api/v1/contacts", undefined, { signal: AbortSignal.abort() })
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops a retry mid-backoff when the caller aborts", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => {
      setTimeout(() => controller.abort(), 5);
      return errorResponse(503);
    });

    const err = await client()
      .get("/api/v1/contacts", undefined, { signal: controller.signal })
      .catch((e: unknown) => e);

    expect((err as Error).name).toBe("AbortError");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("abort during the backoff window (SDK-15)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("skips the backoff entirely when the signal aborted before it started", async () => {
    // The abort lands while the abandoned 503 body is being drained, so the
    // sleep is never armed — the wait must not be served anyway.
    const controller = new AbortController();
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => {
      controller.abort();
      return errorResponse(503);
    });

    const err = await client()
      .get("/api/v1/contacts", undefined, { signal: controller.signal })
      .catch((e: unknown) => e);

    expect((err as Error).name).toBe("AbortError");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("retry policy (SDK-15)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("retries a GET through a network failure", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockRejectedValueOnce(new TypeError("fetch failed"));
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await client().get<{ data: unknown[] }>("/api/v1/contacts");
    expect(result.data).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries a KEYED POST through a network failure — the key makes it safe", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockRejectedValueOnce(new TypeError("fetch failed"));
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: "bk_1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await client().postOnce<{ data: { id: string } }>("/api/v1/bookings", {});
    expect(result.data.id).toBe("bk_1");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry an UNKEYED POST through a network failure", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockRejectedValue(new TypeError("fetch failed"));

    await expect(client().post("/api/v1/gdpr/consent", {})).rejects.toBeInstanceOf(
      MedalNetworkError,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-throws a non-network failure from fetch unchanged", async () => {
    // Only a TypeError means "the request never produced a response". A bug in
    // a caller's own fetch wrapper must not be relabelled as a network outage.
    const bug = new RangeError("someone patched fetch badly");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(bug);

    await expect(client().get("/api/v1/contacts")).rejects.toBe(bug);
  });

  it("honours a Retry-After HTTP-date", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(
      // `toUTCString` truncates to whole seconds, so ask for two and assert
      // the second-boundary floor of one.
      errorResponse(429, { "retry-after": new Date(Date.now() + 2000).toUTCString() }),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const start = Date.now();
    await client().get("/api/v1/contacts");
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("retry helpers (SDK-15)", () => {
  it("parses numeric Retry-After seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    // A proxy that answers a decimal means a second and a half, not "no header"
    // — and `Date.parse("1.5")` happens to be a date in 2001, so falling through
    // to the date branch would silently discard the server's wait.
    expect(parseRetryAfterMs("1.5")).toBe(1500);
  });

  it("parses an HTTP-date Retry-After relative to now", () => {
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    expect(parseRetryAfterMs("Fri, 11 Sep 2026 12:00:30 GMT", now)).toBe(30_000);
  });

  it("clamps an HTTP-date already in the past to zero", () => {
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    expect(parseRetryAfterMs("Fri, 11 Sep 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null for a missing or unparseable value", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("   ")).toBeNull();
    expect(parseRetryAfterMs("invalid")).toBeNull();
  });

  it("grows exponentially and spreads the herd by ±25%", () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(250);
    expect(backoffDelayMs(2, () => 0.5)).toBe(500);
    expect(backoffDelayMs(3, () => 0.5)).toBe(1000);
    // random() 0 → the low end of the jitter window, 1 → the high end.
    expect(backoffDelayMs(1, () => 0)).toBe(188);
    expect(backoffDelayMs(1, () => 1)).toBe(313);
  });

  it("never returns a negative delay", () => {
    expect(backoffDelayMs(0, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

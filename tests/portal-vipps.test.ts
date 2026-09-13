import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal, MedalApiError } from "../src";

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

describe("portal.login.vipps.start (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the authorize URL to send the customer to", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/vipps/start`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        return_url: "https://salon.no/min-side",
      });
      return mockJson({ data: { authorize_url: "https://api.vipps.no/authorize?state=abc" } });
    });

    const { data } = await medal().portal.login.vipps.start({
      return_url: "https://salon.no/min-side",
    });
    expect(data.authorize_url).toContain("vipps.no/authorize");
  });

  it("surfaces INVALID_RETURN_URL for a URL the workspace's sites do not vouch for", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson(
        {
          error: {
            code: "INVALID_RETURN_URL",
            message: "return_url must be an https URL under one of the workspace sites",
          },
        },
        400,
      ),
    );

    const err = await medal()
      .portal.login.vipps.start({ return_url: "https://evil.example/steal" })
      .catch((e: unknown) => e);
    expect((err as MedalApiError).code).toBe("INVALID_RETURN_URL");
  });
});

describe("portal.login.vipps.exchange (SDK-6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("exchanges the one-time grant for a portal session", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/vipps/exchange`);
      expect(JSON.parse(init?.body as string)).toEqual({ grant: "g_1" });
      return mockJson({
        data: {
          session_token: "ps_1",
          expires_at: 1_790_000_000_000,
          expires_at_iso: "2026-09-18T12:00:00.000Z",
        },
      });
    });

    const { data } = await medal().portal.login.vipps.exchange({ grant: "g_1" });
    expect(data.session_token).toBe("ps_1");
    expect(data.expires_at_iso).toBe("2026-09-18T12:00:00.000Z");
  });

  it("sends the grant exactly once — a retry would meet a consumed grant", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValue(new Response("", { status: 503, statusText: "Error" }));

    await expect(medal().portal.login.vipps.exchange({ grant: "g_1" })).rejects.toBeInstanceOf(
      MedalApiError,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

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

describe("portal.login.vipps.verifyLink (SP10)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("confirms a pending link with the e-mailed code and returns a session with its contact", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/portal/vipps/link/verify`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("idempotency-key")).toBeNull();
      expect(JSON.parse(init?.body as string)).toEqual({
        link: "l_1",
        code: "123456",
        browser_binding: "b".repeat(32),
      });
      return mockJson({
        data: {
          session_token: "ps_1",
          expires_at: 1_790_000_000_000,
          expires_at_iso: "2026-09-18T12:00:00.000Z",
          contact: { contact_id: "c_1", first_name: "Kari" },
        },
      });
    });

    const { data } = await medal().portal.login.vipps.verifyLink({
      link: "l_1",
      code: "123456",
      browser_binding: "b".repeat(32),
    });
    expect(data.session_token).toBe("ps_1");
    expect(data.contact.first_name).toBe("Kari");
  });

  it("surfaces VIPPS_IDENTITY_CONFLICT as a 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson(
        {
          error: {
            code: "VIPPS_IDENTITY_CONFLICT",
            message: "This Vipps account is already linked to another customer at this salon",
          },
        },
        409,
      ),
    );

    const err = await medal()
      .portal.login.vipps.verifyLink({ link: "l_1", code: "123456" })
      .catch((e: unknown) => e);
    expect((err as MedalApiError).status).toBe(409);
    expect((err as MedalApiError).code).toBe("VIPPS_IDENTITY_CONFLICT");
  });

  it("is sent exactly once — the right code consumes the link", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 503, statusText: "Error" }));

    await expect(
      medal().portal.login.vipps.verifyLink({ link: "l_1", code: "123456" }),
    ).rejects.toBeInstanceOf(MedalApiError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

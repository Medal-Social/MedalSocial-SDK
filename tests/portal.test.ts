import { beforeEach, describe, expect, it, vi } from "vitest";
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

const profile = {
  contact_id: "c_1",
  email: "ida@example.com",
  first_name: "Ida",
  last_name: null,
  phone: "+4790000000",
  family: [{ name: "Ola", birth_year: 2018 }],
  marketing_consent: false,
  created_at: 1_700_000_000_000,
};

describe("portal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is registered on the client", () => {
    const medal = new Medal("medal_test", { baseUrl: BASE });
    expect(medal.portal).toBeDefined();
    expect(medal.portal.login).toBeDefined();
  });

  it("starts a login by posting the address and locale", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/login/start");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      // Deliberately unkeyed and never session-bound.
      expect(headers.get("idempotency-key")).toBeNull();
      expect(headers.get("x-portal-session")).toBeNull();
      expect(JSON.parse(init?.body as string)).toEqual({ email: "ida@example.com", locale: "nb" });
      return mockJson({ data: { status: "sent" } }, 202);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.login.start({ email: "ida@example.com", locale: "nb" });
    expect(data.status).toBe("sent");
  });

  it("verifies a code and returns the session", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/login/verify");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("idempotency-key")).toBeNull();
      expect(JSON.parse(init?.body as string)).toEqual({
        email: "ida@example.com",
        code: "123456",
      });
      return mockJson({
        data: {
          session_token: SESSION,
          expires_at: 1_700_000_900_000,
          contact: { contact_id: "c_1", first_name: "Ida" },
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.login.verify({ email: "ida@example.com", code: "123456" });
    expect(data.session_token).toBe(SESSION);
    expect(data.contact.contact_id).toBe("c_1");
  });

  it("sends the session header, and no idempotency key, on every session-bound call", async () => {
    const seen: { method: string; path: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-portal-session")).toBe(SESSION);
      expect(headers.get("idempotency-key")).toBeNull();
      expect(headers.get("authorization")).toBe("Bearer medal_test");
      const path = new URL(url as string).pathname;
      seen.push({ method: init?.method as string, path });
      if (path === "/api/v1/portal/logout" || path === "/api/v1/portal/me/delete") {
        return new Response(null, { status: 204 });
      }
      if (path === "/api/v1/portal/me/bookings") {
        return mockJson({ data: { upcoming: [], past: [] } });
      }
      if (path === "/api/v1/portal/me/export") {
        return mockJson({
          data: {
            exported_at: 1_700_000_000_000,
            contact: profile,
            family: profile.family,
            consents: [],
            bookings: [],
          },
        });
      }
      return mockJson({ data: profile });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.portal.me(SESSION);
    await medal.portal.updateMe(SESSION, { first_name: "Ida" });
    await medal.portal.myBookings(SESSION);
    await medal.portal.exportMyData(SESSION);
    await medal.portal.logout(SESSION);
    await medal.portal.deleteMe(SESSION);

    expect(seen).toEqual([
      { method: "GET", path: "/api/v1/portal/me" },
      { method: "PATCH", path: "/api/v1/portal/me" },
      { method: "GET", path: "/api/v1/portal/me/bookings" },
      { method: "POST", path: "/api/v1/portal/me/export" },
      { method: "POST", path: "/api/v1/portal/logout" },
      { method: "POST", path: "/api/v1/portal/me/delete" },
    ]);
  });

  it("reads the profile", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/me");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      return mockJson({ data: profile });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.me(SESSION);
    expect(data.email).toBe("ida@example.com");
    expect(data.family[0].birth_year).toBe(2018);
  });

  it("patches the profile with the supplied fields only", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/me");
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(init?.body as string)).toEqual({
        phone: null,
        family: [{ name: "Ola", birth_year: 2018 }],
        marketing_consent: true,
      });
      return mockJson({ data: { ...profile, phone: null, marketing_consent: true } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.updateMe(SESSION, {
      phone: null,
      family: [{ name: "Ola", birth_year: 2018 }],
      marketing_consent: true,
    });
    expect(data.phone).toBeNull();
    expect(data.marketing_consent).toBe(true);
  });

  it("lists bookings split into upcoming and past", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/me/bookings");
      expect(init?.method).toBe("GET");
      return mockJson({
        data: {
          upcoming: [
            {
              booking_id: "bk_2",
              status: "confirmed",
              start_ts: 1_800_000_000_000,
              end_ts: 1_800_003_600_000,
              service_id: "svc_1",
              service_name: "Klipp",
              resource_id: "res_1",
              resource_name: "Kari",
              booked_for_name: "Ola",
              amount_ore: 49_900,
              notes: null,
              manage_token: "mt_2",
              can_manage: true,
            },
          ],
          past: [
            {
              booking_id: "bk_1",
              status: "completed",
              start_ts: 1_600_000_000_000,
              end_ts: 1_600_003_600_000,
              service_id: null,
              service_name: null,
              resource_id: null,
              resource_name: null,
              booked_for_name: null,
              amount_ore: null,
              notes: null,
              manage_token: null,
              can_manage: false,
            },
          ],
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.myBookings(SESSION);
    expect(data.upcoming[0].manage_token).toBe("mt_2");
    expect(data.upcoming[0].can_manage).toBe(true);
    expect(data.past[0].manage_token).toBeNull();
  });

  it("exports the contact's data with a bodyless POST", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/me/export");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("x-portal-session")).toBe(SESSION);
      return mockJson({
        data: {
          exported_at: 1_700_000_000_000,
          contact: profile,
          family: profile.family,
          consents: [
            {
              consent_type: "marketing_email",
              granted: false,
              granted_at: null,
              revoked_at: 1_700_000_000_000,
              source: "portal",
            },
          ],
          bookings: [],
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.exportMyData(SESSION);
    expect(data.contact.contact_id).toBe("c_1");
    expect(data.consents[0].source).toBe("portal");
  });

  it("resolves logout to undefined on a 204", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/logout");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      return new Response(null, { status: 204 });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.portal.logout(SESSION)).resolves.toBeUndefined();
  });

  it("resolves deleteMe to undefined on a 204", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(new URL(url as string).pathname).toBe("/api/v1/portal/me/delete");
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 204 });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.portal.deleteMe(SESSION)).resolves.toBeUndefined();
  });

  it("surfaces an invalid session as a 401 MedalApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson(
        { error: { code: "PORTAL_SESSION_INVALID", message: "Session expired or revoked" } },
        401,
      ),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const err = await medal.portal.me("sess_expired").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedalApiError);
    const apiError = err as MedalApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe("PORTAL_SESSION_INVALID");
    expect(apiError.message).toBe("Session expired or revoked");
  });

  it.each([
    ["verify", (m: Medal) => m.portal.login.verify({ email: "ida@example.com", code: "123456" })],
    ["logout", (m: Medal) => m.portal.logout("sess_1")],
    ["deleteMe", (m: Medal) => m.portal.deleteMe("sess_1")],
  ])("%s goes to the wire exactly once even on a 503", async (_name, call) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockJson({ error: { code: "UPSTREAM", message: "down" } }, 503));
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(call(medal)).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("login.start still retries a 503 (re-sending the same code is harmless)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockJson({ error: { code: "UPSTREAM", message: "down" } }, 503))
      .mockResolvedValueOnce(mockJson({ data: { status: "sent" } }, 202));
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.portal.login.start({ email: "ida@example.com" });
    expect(data.status).toBe("sent");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a wrong code as PORTAL_CODE_INVALID without retrying", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        mockJson({ error: { code: "PORTAL_CODE_INVALID", message: "Invalid code" } }, 401),
      );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(
      medal.portal.login.verify({ email: "ida@example.com", code: "000000" }),
    ).rejects.toMatchObject({ status: 401, code: "PORTAL_CODE_INVALID" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

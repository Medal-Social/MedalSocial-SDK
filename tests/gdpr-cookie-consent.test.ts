/**
 * `gdpr.cookieConsent()` against the endpoint's real wire shape.
 *
 * 1.10.0 typed this method with a shape the API has never accepted — a
 * `consentStatus` / `consentTimestamp` / `cookiePreferences` body — so calling
 * it exactly as typed returned 400 every time. The old unit test asserted only
 * that `body.domain` survived, which that shape happens to share, so the drift
 * was invisible.
 *
 * These tests compare the serialised request against a fixture replayed
 * through the endpoint's own validator, so the SDK can only drift again by
 * changing a file that says what the server accepts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieConsentInput } from "../src";
import { Medal } from "../src";
import recorded from "./fixtures/cookie-consent.recorded.json";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/**
 * What a caller writes, spelled out as a literal so TypeScript really checks it
 * against `CookieConsentInput` — a cast to the fixture's JSON type would tell
 * the compiler to trust it and check nothing.
 *
 * The first test then asserts this equals the fixture byte for byte, so the two
 * halves of the contract are pinned together: the literal fails to COMPILE if
 * the SDK type drifts, and the equality fails at RUNTIME if the wire shape does.
 */
const RECORDED_INPUT: CookieConsentInput = {
  event: "preferences_saved",
  consentId: "CID-00001234",
  domain: "example.com",
  categories: {
    essential: true,
    analytics: true,
    marketing: false,
    functional: true,
  },
  visitorId: "anon-abc123",
  consentText:
    "We use essential cookies to run this site and optional cookies only with your consent.",
  policyVersion: "2.1",
  timestamp: 1_789_000_000_000,
};

describe("gdpr.cookieConsent", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("serialises the endpoint's recorded request body, field for field", async () => {
    let sent: unknown;
    let sentUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      sentUrl = String(url);
      sent = JSON.parse(init?.body as string);
      return mockJson(recorded.response.body);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.gdpr.cookieConsent(RECORDED_INPUT);

    expect(sentUrl).toBe(`${BASE}/api/cookie-consent`);
    // The typed literal must BE the recorded body — this is what ties the
    // compile-time check above to the bytes the endpoint accepted.
    expect(RECORDED_INPUT).toEqual(recorded.request.body);
    // Exact equality, not a subset: an extra field the server does not know is
    // as much a drift as a missing one.
    expect(sent).toEqual(recorded.request.body);
    expect(result).toEqual(recorded.response.body);
    expect(result.logId).toBe(recorded.response.body.logId);
  });

  it("sends only the four known categories, as booleans", async () => {
    let sent: { categories?: Record<string, unknown> } = {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(init?.body as string);
      return mockJson(recorded.response.body);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.gdpr.cookieConsent({
      event: "banner_displayed",
      consentId: "CID-2",
      domain: "example.com",
      categories: { essential: true },
    });

    expect(Object.keys(sent.categories ?? {})).toEqual(["essential"]);
    expect(sent.categories?.essential).toBe(true);
  });

  it("omits optional fields the caller did not set", async () => {
    let sent: Record<string, unknown> = {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(init?.body as string);
      return mockJson({ success: true });
    });

    const medal = new Medal("medal_test", { baseUrl: BASE });
    const result = await medal.gdpr.cookieConsent({
      event: "preferences_revoked",
      consentId: "CID-3",
      domain: "example.com",
      categories: { essential: true, analytics: false },
    });

    expect(Object.keys(sent).sort()).toEqual(["categories", "consentId", "domain", "event"]);
    // `logId` is optional on the wire, so a body without one must still resolve.
    expect(result).toEqual({ success: true });
  });

  it("surfaces the 403 the endpoint answers for an unowned domain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJson({ success: false, error: "domain is not registered to this workspace" }, 403),
    );

    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(
      medal.gdpr.cookieConsent({
        event: "preferences_saved",
        consentId: "CID-4",
        domain: "someone-elses-site.example",
        categories: { essential: true },
      }),
    ).rejects.toThrow(/domain is not registered to this workspace/);
  });

  it("no longer accepts the 1.10.0 shape the endpoint rejects", () => {
    // The fixture records what that shape gets back from the real validator.
    expect(recorded.rejected.status).toBe(400);
    expect(recorded.rejected.error).toMatch(/Invalid event/);

    // @ts-expect-error - the 1.10.0 shape must not satisfy CookieConsentInput
    const _rejected: CookieConsentInput = recorded.rejected.body;
    void _rejected;
  });
});

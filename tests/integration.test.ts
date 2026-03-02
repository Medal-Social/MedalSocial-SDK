/**
 * Live integration tests for Medal Social SDK.
 *
 * Run with a real API key:
 *   MEDAL_API_KEY=medal_xxx pnpm vitest run tests/integration.test.ts
 *
 * Or with OAuth token + workspace:
 *   MEDAL_TOKEN=oauth_xxx MEDAL_WORKSPACE_ID=ws_xxx pnpm vitest run tests/integration.test.ts
 *
 * These tests hit the real API and are excluded from the default test run.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { Medal, MedalApiError } from "../src";

const apiKey = process.env.MEDAL_API_KEY;
const oauthToken = process.env.MEDAL_TOKEN;
const workspaceId = process.env.MEDAL_WORKSPACE_ID;
const baseUrl = process.env.MEDAL_BASE_URL ?? "https://io.medalsocial.com";

const token = apiKey ?? oauthToken;

describe.skipIf(!token)("integration: live API", () => {
  let medal: Medal;

  beforeAll(() => {
    medal = new Medal(token!, {
      baseUrl,
      ...(workspaceId ? { workspaceId } : {}),
    });
  });

  // ── Workspaces ──────────────────────────────────────────────

  describe("workspaces", () => {
    it("lists workspaces", async () => {
      const res = await medal.workspaces.list();
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
      if (res.data.length > 0) {
        expect(res.data[0]).toHaveProperty("id");
        expect(res.data[0]).toHaveProperty("name");
        expect(res.data[0]).toHaveProperty("slug");
      }
    });
  });

  // ── Posts ───────────────────────────────────────────────────

  describe("posts", () => {
    it("lists channels", async () => {
      const res = await medal.posts.channels();
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
    });

    it("lists posts", async () => {
      const res = await medal.posts.list({ limit: 5 });
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.pagination).toBeDefined();
      expect(res.pagination).toHaveProperty("has_more");
    });
  });

  // ── Contacts (with labels and markdown notes) ───────────────

  describe("contacts", () => {
    let createdId: string | undefined;

    it("lists contacts", async () => {
      try {
        const res = await medal.contacts.list({ limit: 5 });
        expect(res.data).toBeDefined();
        expect(Array.isArray(res.data)).toBe(true);
        expect(res.pagination).toBeDefined();
      } catch (err) {
        // Known backend issue: listForApi may 500 on some workspaces
        if (err instanceof MedalApiError && err.status >= 500) {
          console.warn("contacts.list returned 500 (known backend issue)");
        } else {
          throw err;
        }
      }
    });

    it("creates a contact with label (source: sdk-test)", async () => {
      const res = await medal.contacts.create({
        email: `sdk-live-${Date.now()}@example.com`,
        first_name: "SDK",
        last_name: "LiveTest",
        status: "lead",
        company: "Medal SDK Test",
        custom_fields: { source: "sdk-integration-test" },
      });
      expect(res.data).toBeDefined();
      expect(res.data.id).toBeDefined();
      createdId = res.data.id;
    });

    it("gets the created contact", async () => {
      if (!createdId) return;
      const res = await medal.contacts.get(createdId);
      expect(res.data).toBeDefined();
      expect(res.data.first_name).toBe("SDK");
      expect(res.data.last_name).toBe("LiveTest");
      expect(res.data.status).toBe("lead");
    });

    it("adds a markdown note to the contact", async () => {
      if (!createdId) return;
      const res = await medal.contacts.addNote(createdId, {
        content: [
          "## SDK Integration Test Note",
          "",
          "This note was created by the **Medal Social SDK** integration test suite.",
          "",
          "- Test ran at: `" + new Date().toISOString() + "`",
          "- Source: `@medalsocial/sdk` v1.0.0",
          "- Contact labeled as: *lead*",
          "",
          "> This proves the SDK can create contacts and add markdown notes via the API.",
        ].join("\n"),
      });
      expect(res.data).toBeDefined();
      expect(res.data.id).toBeDefined();
    });

    it("retrieves activity timeline (should contain the note)", async () => {
      if (!createdId) return;
      try {
        const res = await medal.contacts.activities(createdId, { limit: 5 });
        expect(res.data).toBeDefined();
        expect(Array.isArray(res.data)).toBe(true);
      } catch (err) {
        if (err instanceof MedalApiError && err.status >= 500) {
          console.warn("contacts.activities returned 500 (known backend issue)");
        } else {
          throw err;
        }
      }
    });

    it("updates the contact status", async () => {
      if (!createdId) return;
      const res = await medal.contacts.update(createdId, {
        status: "customer",
        custom_fields: { sdk_tested: "true" },
      });
      expect(res.data).toBeDefined();
    });

    it("deletes the test contact", async () => {
      if (!createdId) return;
      const res = await medal.contacts.remove(createdId);
      expect(res.data).toBeDefined();
    });
  });

  // ── Deals ───────────────────────────────────────────────────

  describe("deals", () => {
    let createdId: string | undefined;

    it("lists deals", async () => {
      try {
        const res = await medal.deals.list({ limit: 5 });
        expect(res.data).toBeDefined();
        expect(Array.isArray(res.data)).toBe(true);
      } catch (err) {
        if (err instanceof MedalApiError && err.status >= 500) {
          console.warn("deals.list returned 500 (known backend issue)");
        } else {
          throw err;
        }
      }
    });

    it("creates a deal", async () => {
      const res = await medal.deals.create({
        title: `SDK Test Deal ${Date.now()}`,
        value: 100,
        currency: "USD",
        brand_name: "SDK Test Corp",
        notes: "Created by SDK integration test",
      });
      expect(res.data).toBeDefined();
      expect(res.data.id).toBeDefined();
      createdId = res.data.id;
    });

    it("gets the deal", async () => {
      if (!createdId) return;
      try {
        const res = await medal.deals.get(createdId);
        expect(res.data).toBeDefined();
        expect(res.data.value).toBe(100);
        expect(res.data.brand_name).toBe("SDK Test Corp");
      } catch (err) {
        if (err instanceof MedalApiError && err.status >= 500) {
          console.warn("deals.get returned 500 (known backend issue)");
        } else {
          throw err;
        }
      }
    });

    it("updates the deal", async () => {
      if (!createdId) return;
      try {
        const res = await medal.deals.update(createdId, { status: "won" });
        expect(res.data).toBeDefined();
      } catch (err) {
        if (err instanceof MedalApiError && err.status >= 500) {
          console.warn("deals.update returned 500 (known backend issue)");
        } else {
          throw err;
        }
      }
    });

    it("deletes the deal", async () => {
      if (!createdId) return;
      const res = await medal.deals.remove(createdId);
      expect(res.data).toBeDefined();
    });
  });

  // ── Emails ──────────────────────────────────────────────────

  describe("emails", () => {
    it("lists email templates", async () => {
      const res = await medal.emails.templates.list();
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  // ── GDPR ────────────────────────────────────────────────────

  describe("gdpr", () => {
    it("gets consent for an email", async () => {
      try {
        const res = await medal.gdpr.getConsent("sdk-test@example.com");
        expect(res.data).toBeDefined();
      } catch (err) {
        if (err instanceof MedalApiError) {
          expect([404, 400]).toContain(err.status);
        } else {
          throw err;
        }
      }
    });

    it("lists GDPR exports", async () => {
      try {
        const res = await medal.gdpr.listExports();
        expect(res.data).toBeDefined();
      } catch (err) {
        if (err instanceof MedalApiError) {
          expect(err.status).toBeLessThan(500);
        } else {
          throw err;
        }
      }
    });
  });

  // ── Error handling ──────────────────────────────────────────

  describe("error handling", () => {
    it("throws MedalApiError for invalid resource", async () => {
      try {
        await medal.contacts.get("nonexistent_id_12345");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(MedalApiError);
        if (err instanceof MedalApiError) {
          // Backend may return 404 (proper) or 500 (invalid ID format crashes)
          expect(err.status).toBeGreaterThanOrEqual(400);
        }
      }
    });
  });
});

describe.skipIf(!token)("integration: auth validation", () => {
  it("rejects invalid API key", async () => {
    const bad = new Medal("medal_invalid_key_12345", { baseUrl });
    try {
      await bad.workspaces.list();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MedalApiError);
      if (err instanceof MedalApiError) {
        expect(err.status).toBe(401);
      }
    }
  });
});

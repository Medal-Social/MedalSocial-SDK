import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";
import type { RequestOptions } from "../src/client";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/** Record the `Idempotency-Key` of every request a call makes. */
function captureKeys(body: unknown = { data: {} }, status = 200) {
  const keys: (string | null)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    keys.push(new Headers(init?.headers).get("idempotency-key"));
    return mockJson(body, status);
  });
  return keys;
}

/**
 * Every POST whose repeat would create a SECOND record — a second contact, a
 * second deal, a second email in someone's inbox.
 *
 * `BaseClient.request` retries 429 and 5xx three times, so any of these that
 * went out unkeyed would be re-submitted after a write that had already
 * committed. Unkeyed is not merely "undeduplicated": with no key the server's
 * idempotency machinery is skipped outright and the handler simply runs again.
 */
const KEYED_WRITES: {
  name: string;
  call: (medal: Medal, options?: RequestOptions) => Promise<unknown>;
}[] = [
  {
    name: "posts.create",
    call: (m, o) => m.posts.create({ content: "Hei", channel_ids: ["ch_1"] }, o),
  },
  { name: "contacts.create", call: (m, o) => m.contacts.create({ email: "a@x.com" }, o) },
  {
    name: "contacts.addNote",
    call: (m, o) => m.contacts.addNote("c_1", { content: "Ring tilbake" }, o),
  },
  { name: "contacts.import", call: (m, o) => m.contacts.import([{ email: "a@x.com" }], o) },
  {
    name: "emails.send",
    call: (m, o) => m.emails.send({ template_slug: "welcome", to: "a@x.com" }, o),
  },
  {
    name: "emails.batch",
    call: (m, o) =>
      m.emails.batch({ template_slug: "news", recipients: [{ email: "a@x.com" }] }, o),
  },
  { name: "deals.create", call: (m, o) => m.deals.create({ title: "Acme" }, o) },
  { name: "scan.create", call: (m, o) => m.scan.create({ name: "Eksempel AS" }, o) },
  {
    name: "helpdesk.replies.create",
    call: (m, o) => m.helpdesk.replies.create({ conversation_id: "cv_1", body: "Hei" }, o),
  },
  {
    name: "webhooks.create",
    call: (m, o) =>
      m.webhooks.create({ name: "Hook", url: "https://x.test/hook", event_types: ["*"] }, o),
  },
  {
    name: "channels.connectLinks.create",
    call: (m, o) => m.channels.connectLinks.create({ channel_type: "telegram_inbox" }, o),
  },
  { name: "gdpr.requestExport", call: (m, o) => m.gdpr.requestExport(o) },
];

/**
 * Writes deliberately left unkeyed. Each is either idempotent at the source or
 * would be made WORSE by a key — see the reasoning on each method. This list is
 * the audit itself: a method moving into it (or out of it) is a decision, and
 * this test is where that decision has to be re-argued.
 */
const UNKEYED_WRITES: { name: string; call: (medal: Medal) => Promise<unknown> }[] = [
  { name: "posts.schedule", call: (m) => m.posts.schedule("p_1", { scheduled_at: 1780000000000 }) },
  { name: "posts.publish", call: (m) => m.posts.publish("p_1") },
  {
    name: "gdpr.recordConsent",
    call: (m) =>
      m.gdpr.recordConsent({ email: "a@x.com", consent_type: "marketing_email", granted: true }),
  },
  {
    name: "gdpr.cookieConsent",
    call: (m) =>
      m.gdpr.cookieConsent({
        domain: "x.test",
        consentStatus: "granted",
        consentTimestamp: "2026-08-28T10:00:00Z",
        cookiePreferences: { necessary: { allowed: true } },
      }),
  },
  { name: "webhooks.test", call: (m) => m.webhooks.test("wh_1") },
  {
    name: "capabilityConfirmations.create",
    call: (m) =>
      m.capabilityConfirmations.create({
        capability_id: "helpdesk.conversation.reply.execute",
        idempotency_key: "idem_1",
        preview_summary: "Reply to cv_1",
        user_approved: true,
      }),
  },
];

describe("non-idempotent writes carry an Idempotency-Key", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(KEYED_WRITES)("$name mints one", async ({ call }) => {
    const keys = captureKeys();
    await call(new Medal("medal_test", { baseUrl: BASE }));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]?.trim()).toBe(keys[0]);
  });

  it("gives each logical call its own key", async () => {
    const keys = captureKeys();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    for (const { call } of KEYED_WRITES) await call(medal);
    expect(new Set(keys).size).toBe(KEYED_WRITES.length);
  });

  it.each(KEYED_WRITES)("$name never overwrites a caller-supplied key", async ({ call }) => {
    const keys = captureKeys();
    await call(new Medal("medal_test", { baseUrl: BASE }), { idempotencyKey: "caller_key" });
    expect(keys).toEqual(["caller_key"]);
  });

  it.each(KEYED_WRITES)("$name replaces a blank caller key", async ({ call }) => {
    for (const blank of ["", "   ", "\t\n"]) {
      const keys = captureKeys();
      await call(new Medal("medal_test", { baseUrl: BASE }), { idempotencyKey: blank });
      expect(keys[0], `blank key ${JSON.stringify(blank)} must be replaced`).toBeTruthy();
      vi.restoreAllMocks();
    }
  });
});

describe("idempotent-by-nature writes stay unkeyed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(UNKEYED_WRITES)("$name sends no key", async ({ call }) => {
    const keys = captureKeys();
    await call(new Medal("medal_test", { baseUrl: BASE }));
    expect(keys).toEqual([null]);
  });
});

describe("one key per logical call, not per attempt", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reuses the generated key across every retry of a send", async () => {
    const keys: (string | null)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      if (keys.length === 1) return new Response("", { status: 503, statusText: "Error" });
      return mockJson({ data: { id: "es_1", status: "queued" } }, 202);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    await medal.emails.send({ template_slug: "welcome", to: "a@x.com" });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("cannot send two emails when a 5xx is retried", async () => {
    // The window that matters: the send COMMITTED on the server and then the
    // gateway failed. Unkeyed, the retry queues a second email to a real
    // person. Keyed, the server replays the stored response.
    const sent: string[] = [];
    const seenKeys = new Set<string>();
    let attempt = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      attempt += 1;
      const key = new Headers(init?.headers).get("idempotency-key");
      expect(key, "a send that can be retried must carry a key").toBeTruthy();

      if (seenKeys.has(key as string)) {
        return mockJson({ data: { id: sent[0], status: "queued" } }, 202);
      }
      seenKeys.add(key as string);
      sent.push(`es_${sent.length + 1}`);

      if (attempt === 1) return new Response("", { status: 502, statusText: "Error" });
      return mockJson({ data: { id: sent[0], status: "queued" } }, 202);
    });

    const medal = new Medal("medal_test", { baseUrl: BASE, timeout: 5000 });
    const { data } = await medal.emails.send({ template_slug: "welcome", to: "a@x.com" });

    expect(attempt).toBe(2); // it really did retry
    expect(seenKeys.size).toBe(1); // …under one key
    expect(sent).toEqual(["es_1"]); // …so exactly ONE email was queued
    expect(data.id).toBe("es_1");
  });
});

describe("capability confirmation binding survives the conversion", () => {
  beforeEach(() => vi.restoreAllMocks());

  // A confirmation token is bound to the idempotency key it was minted with.
  // Minting a fresh key at POST time would break that binding, so the key the
  // confirmer chose has to be the key that goes out on the wire.
  const CONFIRMED_WRITES: {
    name: string;
    path: string;
    call: (medal: Medal, options?: RequestOptions) => Promise<unknown>;
  }[] = [
    {
      name: "helpdesk.replies.create",
      path: "/api/v1/helpdesk/replies",
      call: (m, o) => m.helpdesk.replies.create({ conversation_id: "cv_1", body: "Hei" }, o),
    },
    {
      name: "webhooks.create",
      path: "/api/v1/webhooks",
      call: (m, o) =>
        m.webhooks.create({ name: "Hook", url: "https://x.test/hook", event_types: ["*"] }, o),
    },
    {
      name: "channels.connectLinks.create",
      path: "/api/v1/channels/connect-links",
      call: (m, o) => m.channels.connectLinks.create({ channel_type: "telegram_inbox" }, o),
    },
  ];

  it.each(CONFIRMED_WRITES)("$name posts under the key it minted", async ({ path, call }) => {
    let mintedKey: string | undefined;
    let sentKey: string | null = null;
    let sentToken: string | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const { pathname } = new URL(url as string);
      if (pathname === "/api/v1/capability-confirmations") {
        mintedKey = JSON.parse(init?.body as string).idempotency_key;
        return mockJson({ data: { confirmation_token: "mcct_1", idempotency_key: mintedKey } });
      }
      expect(pathname).toBe(path);
      const headers = new Headers(init?.headers);
      sentKey = headers.get("idempotency-key");
      sentToken = headers.get("x-capability-confirmation");
      return mockJson({ data: {} }, 201);
    });

    const medal = new Medal("medal_test", {
      baseUrl: BASE,
      autoConfirmCapabilities: { previewSummary: () => "Approved by a human" },
    });
    await call(medal);

    expect(mintedKey).toBeTruthy();
    expect(sentKey).toBe(mintedKey);
    expect(sentToken).toBe("mcct_1");
  });

  it.each(CONFIRMED_WRITES)("$name keeps a caller's own pair intact", async ({ call }) => {
    const keys = captureKeys({ data: {} }, 201);
    let token: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      keys.push(headers.get("idempotency-key"));
      token = headers.get("x-capability-confirmation");
      return mockJson({ data: {} }, 201);
    });

    await call(new Medal("medal_test", { baseUrl: BASE }), {
      idempotencyKey: "idem_caller",
      capabilityConfirmation: "mcct_caller",
    });

    expect(keys).toEqual(["idem_caller"]);
    expect(token).toBe("mcct_caller");
  });

  // A blank key has to read as "no key" to the confirmer as well, not just to
  // `postOnce`. Bind the token to `"   "` and let `postOnce` swap in a real key
  // and the two halves no longer agree — the server rejects a write that both
  // sides believed they had authorized.
  it.each(CONFIRMED_WRITES)(
    "$name binds the token to the key it sends, even when the caller's key is blank",
    async ({ path, call }) => {
      for (const blank of ["", "   ", "\t\n"]) {
        let mintedKey: string | undefined;
        let sentKey: string | null = null;

        const spy = vi.spyOn(globalThis, "fetch");
        spy.mockImplementation(async (url, init) => {
          const { pathname } = new URL(url as string);
          if (pathname === "/api/v1/capability-confirmations") {
            mintedKey = JSON.parse(init?.body as string).idempotency_key;
            return mockJson({ data: { confirmation_token: "mcct_1", idempotency_key: mintedKey } });
          }
          expect(pathname).toBe(path);
          sentKey = new Headers(init?.headers).get("idempotency-key");
          return mockJson({ data: {} }, 201);
        });

        const medal = new Medal("medal_test", {
          baseUrl: BASE,
          autoConfirmCapabilities: { previewSummary: () => "Approved by a human" },
        });
        await call(medal, { idempotencyKey: blank });

        const label = `blank key ${JSON.stringify(blank)}`;
        expect(mintedKey, `${label} must not be bound into the token`).toBeTruthy();
        expect(mintedKey?.trim(), label).toBe(mintedKey);
        expect(sentKey, `${label}: minted and transmitted keys must match`).toBe(mintedKey);
        spy.mockRestore();
      }
    },
  );

  it.each(CONFIRMED_WRITES)(
    "$name re-mints when the caller pairs a blank key with a token",
    async ({ path, call }) => {
      // The caller's token is bound to a key the server can never receive, so
      // it is already unusable. Auto-confirm was opted into — repair the pair
      // rather than send a token that is guaranteed to be rejected.
      let mintedKey: string | undefined;
      let sentKey: string | null = null;
      let sentToken: string | null = null;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const { pathname } = new URL(url as string);
        if (pathname === "/api/v1/capability-confirmations") {
          mintedKey = JSON.parse(init?.body as string).idempotency_key;
          return mockJson({ data: { confirmation_token: "mcct_fresh" } });
        }
        expect(pathname).toBe(path);
        const headers = new Headers(init?.headers);
        sentKey = headers.get("idempotency-key");
        sentToken = headers.get("x-capability-confirmation");
        return mockJson({ data: {} }, 201);
      });

      const medal = new Medal("medal_test", {
        baseUrl: BASE,
        autoConfirmCapabilities: { previewSummary: () => "Approved by a human" },
      });
      await call(medal, { idempotencyKey: "   ", capabilityConfirmation: "mcct_stale" });

      expect(mintedKey).toBeTruthy();
      expect(sentKey).toBe(mintedKey);
      expect(sentToken).toBe("mcct_fresh");
    },
  );
});

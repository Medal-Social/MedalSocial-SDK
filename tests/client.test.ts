import { beforeEach, describe, expect, it, vi } from "vitest";
import MedalSocialClient from "../src";

describe("MedalSocialClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Client-Id and Client-Secret headers for basic auth", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Headers = init?.headers as Headers;
        expect(headers.get("Client-Id")).toBe("id");
        expect(headers.get("Client-Secret")).toBe("secret");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "basic", clientId: "id", clientSecret: "secret" },
    });
    const res = await client.createLead([{ name: "Alex", email: "alex@example.com" }]);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("https://api.example.com/v1/leads", expect.any(Object));
  });

  it("throws on non-2xx with parsed error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "t" },
    });
    await expect(
      client.createLead([{ name: "Alex", email: "alex@example.com" }]),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("notes endpoint", () => {
  it("POSTs to /v1/notes with body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/notes");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          name: "Test Testnes",
          email: "test@medalsocial.com",
          company: "Medal Social Test company",
          phone: "+47 12345678",
          content: "Hei jeg skal gjerne sende to konteinere til USA.",
          metadata: { Budsjett: "$100,000" },
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "x" },
    });
    const res = await client.createNote({
      name: "Test Testnes",
      email: "test@medalsocial.com",
      company: "Medal Social Test company",
      phone: "+47 12345678",
      content: "Hei jeg skal gjerne sende to konteinere til USA.",
      metadata: { Budsjett: "$100,000" },
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("cookie consent endpoint", () => {
  it("POSTs to /v1/cookie-consent with body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/cookie-consent");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          domain: "example.com",
          consentStatus: "partial",
          consentTimestamp: "2025-06-04T10:30:00Z",
          ipAddress: "88.151.164.19",
          userAgent: expect.any(String),
          cookiePreferences: {
            necessary: { allowed: true },
            analytics: { allowed: false },
            marketing: { allowed: true },
            functional: { allowed: true },
          },
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "x" },
    });
    const res = await client.createCookieConsent({
      domain: "example.com",
      consentStatus: "partial",
      consentTimestamp: "2025-06-04T10:30:00Z",
      ipAddress: "88.151.164.19",
      userAgent: "Mozilla/5.0",
      cookiePreferences: {
        necessary: {
          allowed: true,
          cookieRecords: [
            {
              cookie: "session_id",
              duration: "Session",
              description: "Essential for user authentication and session management",
            },
          ],
        },
        analytics: { allowed: false },
        marketing: { allowed: true },
        functional: { allowed: true },
      },
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("contact note endpoint", () => {
  it("POSTs to /v1/contacts/notes with body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/contacts/notes");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({ contactId: "cnt_123", note: "Follow up next week" });
        return new Response(JSON.stringify({ id: "note_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "x" },
    });
    const res = await client.createContactNote({
      contactId: "cnt_123",
      note: "Follow up next week",
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("event signup endpoint", () => {
  it("POSTs to /v1/event-signup with body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/event-signup");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          contact: {
            name: "Test Testnes",
            email: "test@medalsocial.com",
            company: "Medal Social Test company",
          },
          event: {
            externalId: "eksadaasdasd",
            name: "Product saus asd",
            description: "Learn about our new product asd",
            time: "2025-06-15T14:00:00Z",
            location: "Online",
            thumbnail: expect.any(String),
          },
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "x" },
    });
    const res = await client.createEventSignup({
      contact: {
        name: "Test Testnes",
        email: "test@medalsocial.com",
        company: "Medal Social Test company",
      },
      event: {
        externalId: "eksadaasdasd",
        name: "Product saus asd",
        description: "Learn about our new product asd",
        time: "2025-06-15T14:00:00Z",
        location: "Online",
        thumbnail:
          "https://medalsocialdevstorage.blob.core.windows.net/images/d05bad9e-bc52-4f8e-8191-d6944d34055c.jpg",
      },
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("transactional email endpoint", () => {
  it("POSTs to /v1/send-transactional-email with body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("https://api.example.com/v1/send-transactional-email");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          to: "test@medalsocial.com",
          slug: "test",
          additionalData: { test: "https://medalsocial.com/" },
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "x" },
    });
    const res = await client.sendTransactionalEmail({
      to: "test@medalsocial.com",
      slug: "test",
      additionalData: { test: "https://medalsocial.com/" },
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("misc coverage paths", () => {
  it("ignores user-agent set errors gracefully", async () => {
    const OriginalHeaders = globalThis.Headers as typeof Headers;
    class ThrowHeaders extends OriginalHeaders {
      set(name: string, value: string) {
        if (name.toLowerCase() === "user-agent") {
          throw new Error("blocked");
        }
        return super.set(name, value);
      }
    }
    // @ts-expect-error override for test
    globalThis.Headers = ThrowHeaders as unknown as typeof Headers;

    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const client = new MedalSocialClient({
        baseUrl: "https://api.example.com",
        auth: { kind: "bearer", token: "t" },
      });
      const res = await client.createLead([{ name: "Alex", email: "alex@example.com" }]);
      expect(res.status).toBe(200);
    } finally {
      // @ts-expect-error restore
      globalThis.Headers = OriginalHeaders as unknown as typeof Headers;
    }
  });

  it("parses non-JSON responses as text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "t" },
    });
    const res = await client.createNote({ name: "N", email: "n@example.com" });
    expect(res.data).toBe("OK");
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "0" } }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new MedalSocialClient({
      baseUrl: "https://api.example.com",
      auth: { kind: "bearer", token: "t" },
      timeoutMs: 1000,
    });
    const res = await client.createNote({ name: "N", email: "n@example.com" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";

const BASE = "https://test.convex.site";

function mockJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("scan", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a scan job from a company name", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/scan");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ name: "Eksempel Bygg AS" });
      return mockJson({ data: { id: "scan_1", status: "pending" } }, 202);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.scan.create({ name: "Eksempel Bygg AS" });
    expect(data.id).toBe("scan_1");
    expect(data.status).toBe("pending");
  });

  it("polls a scan job by id with the id encoded", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/scan/scan%201");
      return mockJson({
        data: {
          id: "scan 1",
          status: "done",
          input: { url: "https://eksempelbygg.no" },
          resolved: { websiteUrl: "https://eksempelbygg.no/" },
          result: { version: 1, nettskaar: 58 },
          error: null,
          created_at: "2026-08-25T12:00:00.000Z",
          finished_at: "2026-08-25T12:00:30.000Z",
        },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.scan.get("scan 1");
    expect(data.status).toBe("done");
    expect(data.result?.nettskaar).toBe(58);
  });

  it("searches the company registry via ?q=", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/api/v1/scan/companies");
      expect(parsed.searchParams.get("q")).toBe("Eksempel Bygg");
      return mockJson({
        data: [
          {
            orgnr: "987654321",
            name: "EKSEMPEL BYGG AS",
            org_form: "AS",
            industry: "Byggevirksomhet",
            city: "BERGEN",
            website: "eksempelbygg.no",
          },
        ],
      });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const { data } = await medal.scan.companies("Eksempel Bygg");
    expect(data).toHaveLength(1);
    expect(data[0].orgnr).toBe("987654321");
  });

  it("waitForResult polls until the job is done", async () => {
    const responses = [
      { data: { id: "scan_1", status: "pending" } },
      { data: { id: "scan_1", status: "running" } },
      { data: { id: "scan_1", status: "done", result: { version: 1, nettskaar: 71 } } },
    ];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const body = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return mockJson(body);
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const job = await medal.scan.waitForResult("scan_1", { intervalMs: 1 });
    expect(call).toBe(3);
    expect(job.status).toBe("done");
    expect(job.result?.nettskaar).toBe(71);
  });

  it("waitForResult returns failed jobs without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "failed", error: "no_website" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const job = await medal.scan.waitForResult("scan_1", { intervalMs: 1 });
    expect(job.status).toBe("failed");
    expect(job.error).toBe("no_website");
  });

  it("waitForResult throws on timeout while the job is still running", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "running" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(
      medal.scan.waitForResult("scan_1", { intervalMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/i);
  });

  it("waitForResult never sleeps past the deadline on a coarse interval", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "running" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const started = Date.now();
    await expect(
      medal.scan.waitForResult("scan_1", { intervalMs: 60_000, timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("waitForResult falls back to the default interval and timeout", async () => {
    // No options at all — exercises the `?? 2500` / `?? 120_000` defaults.
    // The job is done on the first poll, so no default-length sleep happens.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "done", result: { version: 1, nettskaar: 64 } } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const job = await medal.scan.waitForResult("scan_1");
    expect(job.status).toBe("done");
    expect(job.result?.nettskaar).toBe(64);
  });

  it("waitForResult polls exactly once when the timeout is already exhausted", async () => {
    // An outer budget that has run out is passed through as timeoutMs: 0. It
    // must be preserved, not treated as "unset" — one poll, then expiry.
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      return mockJson({ data: { id: "scan_1", status: "running" } });
    });
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.scan.waitForResult("scan_1", { timeoutMs: 0 })).rejects.toThrow(
      /timed out after 0ms \(status: running\)/i,
    );
    expect(call).toBe(1);
  });

  it("waitForResult ignores a non-finite interval instead of polling forever", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "running" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const started = Date.now();
    await expect(
      medal.scan.waitForResult("scan_1", { intervalMs: Number.NaN, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("waitForResult ignores a zero or negative interval", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "running" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const started = Date.now();
    await expect(
      medal.scan.waitForResult("scan_1", { intervalMs: -1, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("waitForResult ignores a non-finite timeout instead of disabling the deadline", async () => {
    // NaN must fall back to the 120s default, not to "no deadline".
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mockJson({ data: { id: "scan_1", status: "done" } }),
    );
    const medal = new Medal("medal_test", { baseUrl: BASE });
    const job = await medal.scan.waitForResult("scan_1", { timeoutMs: Number.NaN });
    expect(job.status).toBe("done");
  });

  it("create rejects zero or several selectors before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await expect(medal.scan.create({})).rejects.toThrow(/exactly one/i);
    await expect(medal.scan.create({ url: "https://a.no", name: "Eksempel" })).rejects.toThrow(
      /exactly one/i,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

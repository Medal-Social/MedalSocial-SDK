import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  ScanCompany,
  ScanCreateInput,
  ScanCreateResult,
  ScanJob,
  WaitForScanOptions,
} from "../types/scan";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Company & website scans (Nettsjekk) — score a Norwegian company's web
 * presence (performance, SEO, GDPR consent, AI visibility, mail auth) from a
 * URL, an organisation number, or a company name.
 */
export class Scan {
  constructor(private client: BaseClient) {}

  /**
   * Queue a scan. Provide exactly one of `url`, `orgnr`, or `name`.
   * Runs asynchronously — poll with `get()` or use `waitForResult()`.
   *
   * @throws Error before any request when zero or several selectors are set —
   * the server would reject the body anyway; failing locally is clearer.
   */
  async create(input: ScanCreateInput): Promise<ApiResponse<ScanCreateResult>> {
    const entries = (["url", "orgnr", "name"] as const).filter(
      (key) => input[key] !== undefined && input[key] !== "",
    );
    if (entries.length !== 1) {
      throw new Error("scan.create requires exactly one of url, orgnr, or name");
    }
    // Send only the effective selector — blank strings from form state must
    // not ride along in the payload (they would echo back in ScanJob.input).
    const key = entries[0];
    return this.client.post("/api/v1/scan", { [key]: input[key] });
  }

  /** Get a scan job's status and, once done, its findings payload. */
  async get(id: string): Promise<ApiResponse<ScanJob>> {
    return this.client.get(`/api/v1/scan/${encodeURIComponent(id)}`);
  }

  /** Search the Norwegian company registry by name (typeahead, top 5 hits). */
  async companies(q: string): Promise<ApiResponse<ScanCompany[]>> {
    return this.client.get("/api/v1/scan/companies", { q });
  }

  /**
   * Poll a scan until it settles. Resolves with the job for both `done` and
   * `failed` (check `job.error`); throws only when the deadline passes while
   * the scan is still pending/running.
   */
  async waitForResult(id: string, options: WaitForScanOptions = {}): Promise<ScanJob> {
    const rawInterval = options.intervalMs ?? 2500;
    const rawTimeout = options.timeoutMs ?? 120_000;
    // Guard against NaN/negative inputs — they would otherwise disable the
    // deadline entirely and poll forever.
    const intervalMs = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 2500;
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000;
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "pending";
    for (;;) {
      const { data } = await this.get(id);
      if (data.status === "done" || data.status === "failed") return data;
      lastStatus = data.status;
      // Sleep only up to the remaining budget, and re-check the deadline
      // after sleeping so no extra poll is issued once time is up.
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(intervalMs, remaining));
      if (Date.now() >= deadline) break;
    }
    throw new Error(`Scan ${id} timed out after ${timeoutMs}ms (status: ${lastStatus})`);
  }
}

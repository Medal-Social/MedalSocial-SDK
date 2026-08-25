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
    const provided = [input.url, input.orgnr, input.name].filter(
      (value) => value !== undefined && value !== "",
    );
    if (provided.length !== 1) {
      throw new Error("scan.create requires exactly one of url, orgnr, or name");
    }
    return this.client.post("/api/v1/scan", input);
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
    const intervalMs = options.intervalMs ?? 2500;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await this.get(id);
      if (data.status === "done" || data.status === "failed") return data;
      // Sleep only up to the remaining budget so a coarse interval can never
      // overshoot the deadline; the final poll happens exactly at timeout.
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Scan ${id} timed out after ${timeoutMs}ms (status: ${data.status})`);
      }
      await sleep(Math.min(intervalMs, remaining));
    }
  }
}

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `scripts/jsr-publish.mjs` runs `main()` at module-evaluation time (top-level
// `process.exitCode = await main()`), so each scenario needs a *fresh*
// evaluation of the module with fresh mocks in place first. `vi.resetModules`
// clears vitest's module cache so the next `import()` re-runs the script.
const SCRIPT_PATH = "../../scripts/jsr-publish.mjs";

// The script reads the real jsr.json for name/version — read it the same way
// here so the expected probe URL isn't hard-coded and can't drift.
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../jsr.json"), "utf8"));
const PROBE_URL = `https://jsr.io/${manifest.name}/${manifest.version}_meta.json`;

const originalArgv = [...process.argv];

/** A fake child process good enough for the `spawn` usage in the script. */
function fakeChild(behavior: { code?: number | null; error?: Error }) {
  const child = new EventEmitter();
  queueMicrotask(() => {
    if (behavior.error) {
      child.emit("error", behavior.error);
    } else {
      child.emit("close", behavior.code ?? 0);
    }
  });
  return child;
}

function mockSpawn(behavior: { code?: number | null; error?: Error }) {
  return vi.fn(() => fakeChild(behavior));
}

function mockProbeResponse(status: number) {
  return new Response(status === 200 ? "{}" : "not found", { status });
}

/** Re-imports the script fresh with argv + child_process mocked as given. */
async function runScript(options: { argv?: string[]; spawn?: ReturnType<typeof mockSpawn> }) {
  process.argv = [...originalArgv.slice(0, 2), ...(options.argv ?? [])];
  vi.doMock("node:child_process", () => ({ spawn: options.spawn ?? mockSpawn({ code: 0 }) }));
  vi.resetModules();
  await import(SCRIPT_PATH);
}

describe("scripts/jsr-publish.mjs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    process.exitCode = originalExitCode;
  });

  it("dry run: prints the plan and publishes nothing", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404));
    const spawn = mockSpawn({ code: 0 });

    await runScript({ argv: ["--dry-run"], spawn });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(PROBE_URL, { method: "GET" });
    expect(spawn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("dry run"));
    expect(process.exitCode).toBe(0);
  });

  it("already-published version (pre-check): skips publish and exits 0", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(200));
    const spawn = mockSpawn({ code: 0 });

    await runScript({ spawn });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("already on JSR"));
    expect(process.exitCode).toBe(0);
  });

  it("publish success path: spawns jsr publish and exits 0", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404));
    const spawn = mockSpawn({ code: 0 });

    await runScript({ spawn });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "jsr", "publish"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(process.exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("publish failure on a not-yet-live version: forwards the CLI's exit code", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404)); // before
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404)); // after
    const spawn = mockSpawn({ code: 7 });

    await runScript({ spawn });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("was not published (exit 7)"));
    expect(process.exitCode).toBe(7);
  });

  it("publish failure but the version is live afterward: warns and exits 0", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404)); // before
    fetchMock.mockResolvedValueOnce(mockProbeResponse(200)); // after
    const spawn = mockSpawn({ code: 1 });

    await runScript({ spawn });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("::warning::jsr publish exited 1"),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("spawn itself fails to start (e.g. ENOENT): treated as a publish failure", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404)); // before
    fetchMock.mockResolvedValueOnce(mockProbeResponse(404)); // after
    const spawn = mockSpawn({ error: new Error("spawn pnpm ENOENT") });

    await runScript({ spawn });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to spawn jsr"));
    expect(process.exitCode).toBe(1);
  });

  it("network error on the probe: warns, treats it as unknown, and still attempts to publish", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const spawn = mockSpawn({ code: 0 });

    await runScript({ spawn });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Could not reach ${PROBE_URL}`));
    expect(spawn).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("unexpected status on the probe: warns, treats it as unknown, and still attempts to publish", async () => {
    fetchMock.mockResolvedValueOnce(mockProbeResponse(500));
    const spawn = mockSpawn({ code: 0 });

    await runScript({ spawn });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Unexpected 500 from ${PROBE_URL}`),
    );
    expect(spawn).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

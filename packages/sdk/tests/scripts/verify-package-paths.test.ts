import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectProcessExit, mockProcessExit } from "./test-support";

// `scripts/verify-package-paths.mjs` runs top-level (no wrapped `main`) and
// calls `process.exit(1)` directly on failure, so every scenario needs a
// fresh module evaluation with `node:fs` mocked first, and `process.exit`
// stubbed so a failing case can't actually kill the test worker.
const SCRIPT_PATH = "../../scripts/verify-package-paths.mjs";

async function runScript() {
  vi.resetModules();
  return expectProcessExit(() => import(SCRIPT_PATH));
}

describe("scripts/verify-package-paths.mjs", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.restoreAllMocks();
  });

  it("passes when every declared entry point resolves to an existing file", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() =>
        JSON.stringify({
          main: "dist/index.js",
          module: "dist/index.mjs",
          types: "dist/index.d.ts",
          exports: {
            ".": {
              types: "./dist/index.d.ts",
              import: "./dist/index.mjs",
              require: "./dist/index.js",
            },
          },
        }),
      ),
      existsSync: vi.fn(() => true),
    }));

    await runScript();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OK"));
  });

  it("fails when a top-level entry point is missing on disk", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => JSON.stringify({ main: "dist/missing.js" })),
      existsSync: vi.fn(() => false),
    }));

    await runScript();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("FAIL"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("main → dist/missing.js"));
  });

  it("walks nested exports and reports the missing conditional path", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() =>
        JSON.stringify({
          exports: {
            ".": { types: "./dist/index.d.ts", import: "./dist/missing.mjs" },
          },
        }),
      ),
      existsSync: vi.fn((path: string) => !String(path).includes("missing")),
    }));

    await runScript();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('exports["."]["import"] → ./dist/missing.mjs'),
    );
  });

  it("skips protocol URLs and bare (non-path-like) values", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() =>
        JSON.stringify({
          bin: { medal: "not-a-path" },
          exports: { node: "some-package" },
        }),
      ),
      existsSync: vi.fn(() => false),
    }));

    await runScript();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

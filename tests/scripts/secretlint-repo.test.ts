import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectProcessExit, mockProcessExit } from "./test-support";

// `scripts/secretlint-repo.mjs` shells out twice via `execFileSync`: once to
// list tracked files, once (conditionally) to run secretlint over them. Both
// calls go through the same mocked `node:child_process` export.
const SCRIPT_PATH = "../../scripts/secretlint-repo.mjs";

async function runScript(execFileSync: ReturnType<typeof vi.fn>) {
  vi.doMock("node:child_process", () => ({ execFileSync }));
  vi.resetModules();
  return expectProcessExit(() => import(SCRIPT_PATH));
}

describe("scripts/secretlint-repo.mjs", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
  });

  it("exits 0 without invoking secretlint when there are no tracked files", async () => {
    const execFileSync = vi.fn(() => "");

    const exitCode = await runScript(execFileSync);

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith("git", ["ls-files", "-z"], { encoding: "utf8" });
    expect(exitCode).toBe(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("runs secretlint over every tracked file", async () => {
    const execFileSync = vi.fn((cmd: string) => (cmd === "git" ? "a.ts\0b.ts\0" : ""));

    const exitCode = await runScript(execFileSync);

    expect(exitCode).toBeNull();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["exec", "secretlint", "a.ts", "b.ts"],
      { stdio: "inherit" },
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

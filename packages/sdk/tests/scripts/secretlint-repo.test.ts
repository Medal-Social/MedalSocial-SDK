import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectProcessExit, mockProcessExit } from "./test-support";

// The script is repo-level tooling: it lives in the repository's root
// scripts/ directory and runs git and secretlint from the repository root. Its
// tests stay with the rest of the script suite here.
// The script derives it from its own URL, so it carries a trailing slash.
const REPO_ROOT = `${resolve(__dirname, "../../../..")}/`;

// `scripts/secretlint-repo.mjs` shells out twice via `execFileSync`: once to
// list tracked files, once (conditionally) to run secretlint over them. Both
// calls go through the same mocked `node:child_process` export.
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/secretlint-repo.mjs");

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
    expect(execFileSync).toHaveBeenCalledWith("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
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
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

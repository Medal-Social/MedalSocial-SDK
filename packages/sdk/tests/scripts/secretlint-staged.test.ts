import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectProcessExit, mockProcessExit } from "./test-support";

// The script is repo-level tooling: it lives in the repository's root
// scripts/ directory and runs git and secretlint from the repository root. Its
// tests stay with the rest of the script suite here.
// The script derives it from its own URL, so it carries a trailing slash.
const REPO_ROOT = `${resolve(__dirname, "../../../..")}/`;

// Mirrors secretlint-repo.test.ts, but this script scopes to staged files via
// `git diff --cached` (newline-separated) instead of `git ls-files -z`.
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/secretlint-staged.mjs");

// Windows runs the `pnpm` shim through a shell; every other platform does not.
const WINDOWS_SHELL = process.platform === "win32" ? { shell: true } : {};

async function runScript(execFileSync: ReturnType<typeof vi.fn>) {
  vi.doMock("node:child_process", () => ({ execFileSync }));
  vi.resetModules();
  return expectProcessExit(() => import(SCRIPT_PATH));
}

describe("scripts/secretlint-staged.mjs", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
  });

  it("exits 0 without invoking secretlint when nothing is staged", async () => {
    const execFileSync = vi.fn(() => "\n");

    const exitCode = await runScript(execFileSync);

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(exitCode).toBe(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("runs secretlint over every staged file", async () => {
    const execFileSync = vi.fn((cmd: string) => (cmd === "git" ? "a.ts\nb.ts\n" : ""));

    const exitCode = await runScript(execFileSync);

    expect(exitCode).toBeNull();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["exec", "secretlint", "a.ts", "b.ts"],
      { cwd: REPO_ROOT, stdio: "inherit", ...WINDOWS_SHELL },
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

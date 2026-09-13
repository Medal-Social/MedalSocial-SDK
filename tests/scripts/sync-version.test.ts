import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectProcessExit, mockProcessExit } from "./test-support";

// `scripts/sync-version.mjs` runs top-level and calls `process.exit(1)` on
// failure, so each scenario is a fresh module evaluation against a throwaway
// root directory passed through `--root`.
const SCRIPT_PATH = "../../scripts/sync-version.mjs";

const YAML_HEAD = [
  "openapi: 3.1.0",
  "info:",
  "  title: Medal Social API",
  "  version: 1.1.7",
  "  description: contract",
  "paths: {}",
  "",
].join("\n");

function versionTs(version: string): string {
  return `export const SDK_VERSION = "${version}";\n`;
}

function scaffold(dir: string, pkgVersion = "1.11.0") {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "openapi"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ version: pkgVersion }, null, 2)}\n`);
  writeFileSync(
    join(dir, "jsr.json"),
    `${JSON.stringify({ name: "x", version: "1.10.0" }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "src", "version.ts"), versionTs("1.0.0"));
  writeFileSync(join(dir, "openapi", "medal-social.openapi.yaml"), YAML_HEAD);
}

async function runScript(...args: string[]) {
  process.argv = ["node", "sync-version.mjs", ...args];
  vi.resetModules();
  return expectProcessExit(() => import(SCRIPT_PATH));
}

describe("scripts/sync-version.mjs", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv = process.argv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sync-version-"));
    scaffold(dir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes package.json's version into jsr.json, src/version.ts and the OpenAPI info block", async () => {
    const code = await runScript("--root", dir);

    expect(code).toBeNull();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(dir, "jsr.json"), "utf8"))).toEqual({
      name: "x",
      version: "1.11.0",
    });
    expect(readFileSync(join(dir, "src", "version.ts"), "utf8")).toContain(
      'export const SDK_VERSION = "1.11.0";',
    );
    const yaml = readFileSync(join(dir, "openapi", "medal-social.openapi.yaml"), "utf8");
    expect(yaml).toContain("  version: 1.11.0\n");
    // Only the info block's version line moved.
    expect(yaml).toBe(YAML_HEAD.replace("version: 1.1.7", "version: 1.11.0"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1.1.7 -> 1.11.0"));
  });

  it("is idempotent: a second run touches nothing and says so", async () => {
    await runScript("--root", dir);
    const before = readFileSync(join(dir, "src", "version.ts"), "utf8");
    logSpy.mockClear();

    const code = await runScript("--root", dir);

    expect(code).toBeNull();
    expect(readFileSync(join(dir, "src", "version.ts"), "utf8")).toBe(before);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("already reads 1.11.0"));
  });

  it("--check fails and names every drifted file", async () => {
    const code = await runScript("--check", "--root", dir);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("FAIL"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("jsr.json says 1.10.0"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("version.ts says 1.0.0"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("openapi.yaml says 1.1.7"));
    // Check mode never writes.
    expect(readFileSync(join(dir, "src", "version.ts"), "utf8")).toBe(versionTs("1.0.0"));
  });

  it("--check passes once everything is in step", async () => {
    await runScript("--root", dir);
    errorSpy.mockClear();

    const code = await runScript("--check", "--root", dir);

    expect(code).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OK"));
  });

  it("refuses a package.json without a semver version", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "next" }));

    const code = await runScript("--root", dir);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("no usable version"));
  });

  it("fails rather than guess when a target has no version to replace", async () => {
    writeFileSync(join(dir, "openapi", "medal-social.openapi.yaml"), "openapi: 3.1.0\npaths: {}\n");

    const code = await runScript("--root", dir);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("could not find a version"));
    // Nothing was written before the failure was detected.
    expect(readFileSync(join(dir, "src", "version.ts"), "utf8")).toBe(versionTs("1.0.0"));
  });

  it("only reads `version:` from inside the info block, not from a later one", async () => {
    // The info block ends at the first dedent; a `version:` under another
    // top-level key (here a component schema) must not be mistaken for it.
    writeFileSync(
      join(dir, "openapi", "medal-social.openapi.yaml"),
      [
        "openapi: 3.1.0",
        "info:",
        "  title: Medal Social API",
        "components:",
        "  schemas:",
        "    Thing:",
        "      version: 9.9.9",
        "",
      ].join("\n"),
    );

    const code = await runScript("--root", dir);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("could not find a version"));
  });

  it("keeps CRLF line endings when rewriting the OpenAPI version", async () => {
    writeFileSync(
      join(dir, "openapi", "medal-social.openapi.yaml"),
      YAML_HEAD.replaceAll("\n", "\r\n"),
    );

    const code = await runScript("--root", dir);

    expect(code).toBeNull();
    const yaml = readFileSync(join(dir, "openapi", "medal-social.openapi.yaml"), "utf8");
    expect(yaml).toBe(
      YAML_HEAD.replace("version: 1.1.7", "version: 1.11.0").replaceAll("\n", "\r\n"),
    );
  });

  it("defaults to the repository root, which is in step", async () => {
    const code = await runScript("--check");

    expect(code).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OK"));
  });
});

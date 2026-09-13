import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Medal } from "../src";
import { SDK_VERSION } from "../src/version";

// Every copy of the version must agree with package.json. Through 1.10.0 the
// User-Agent said `medalsocial-sdk/1.0.0` and the OpenAPI document said
// `1.1.7`, because each was typed by hand once and never again. This suite
// is the gate: `pnpm run version` keeps them in step, and any drift is red.
const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version: string;
};

describe("version is derived from package.json everywhere", () => {
  afterEach(() => vi.restoreAllMocks());

  it("package.json carries a semver version", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("src/version.ts matches", () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("jsr.json matches", () => {
    const jsr = JSON.parse(readFileSync(resolve(root, "jsr.json"), "utf8")) as {
      version: string;
    };
    expect(jsr.version).toBe(pkg.version);
  });

  it("the OpenAPI document's info.version matches", () => {
    const yaml = readFileSync(resolve(root, "openapi", "medal-social.openapi.yaml"), "utf8");
    // Walk the `info:` block line by line (it ends at the first dedent)
    // instead of one multi-line regex — see scripts/sync-version.mjs for why.
    const lines = yaml.split("\n");
    const infoAt = lines.findIndex((line) => /^info:\s*$/.test(line));
    expect(infoAt).toBeGreaterThanOrEqual(0);
    const block = lines.slice(infoAt + 1);
    const dedentAt = block.findIndex((line) => !/^[ \t]/.test(line));
    const versionLine = block
      .slice(0, dedentAt === -1 ? undefined : dedentAt)
      .find((line) => /^[ \t]+version:/.test(line));
    expect(versionLine?.trim()).toBe(`version: ${pkg.version}`);
  });

  it("the User-Agent header names the published version and this repository", async () => {
    let userAgent: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      userAgent = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const medal = new Medal("medal_test", { baseUrl: "https://test.convex.site" });
    await medal.workspaces.list();
    expect(userAgent).toBe(
      `medalsocial-sdk/${pkg.version} (+https://github.com/Medal-Social/MedalSocial-SDK)`,
    );
  });
});

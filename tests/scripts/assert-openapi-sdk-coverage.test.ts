import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The gate's own failure paths.
 *
 * `scripts/assert-openapi-sdk-coverage.mjs` is the check that is supposed to
 * catch drift between the Medal API and this SDK — so the thing worth testing
 * is that it FAILS when fed drift. Each case runs the real script as a child
 * process against fixture documents, then asserts on the exit code and the
 * message, because "it passed" is not evidence that a gate works.
 */
const SCRIPT = "scripts/assert-openapi-sdk-coverage.mjs";
const REAL_SPEC = "dist/openapi/medal-social.openapi.json";
const REDOCLY_CLI = "node_modules/@redocly/cli/bin/cli.js";
const SPEC_SOURCE = "openapi/medal-social.openapi.yaml";

let dir: string;
/** The SDK's real bundled document, used as the base for the drifted fixtures. */
let realSpec: Record<string, unknown>;

function run(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

/** A minimal reference document the SDK is in parity with, plus `extra` ops. */
function reference(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const paths = structuredClone((realSpec as { paths: Record<string, unknown> }).paths);
  return { openapi: "3.1.0", info: { title: "t", version: "0" }, paths: { ...paths, ...extra } };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "medal-parity-"));
  // The bundled document is a build artifact, and `pnpm test` does not build.
  // Bundle it here rather than skipping: a gate test that quietly does not run
  // is the failure mode this whole suite exists to rule out. Any failure to
  // produce it throws and fails the suite.
  if (!existsSync(REAL_SPEC)) {
    execFileSync(process.execPath, [REDOCLY_CLI, "bundle", SPEC_SOURCE, "--output", REAL_SPEC], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
  realSpec = JSON.parse(readFileSync(REAL_SPEC, "utf8"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/assert-openapi-sdk-coverage.mjs — the happy path", () => {
  it("passes against the committed snapshot", () => {
    const { code, output } = run([]);
    expect(code).toBe(0);
    expect(output).toContain("[openapi-coverage] OK");
  });
});

describe("scripts/assert-openapi-sdk-coverage.mjs — API parity failures", () => {
  it("fails when the API has a v1 route the SDK does not", () => {
    const path = write("missing-route.json", {
      ...reference({
        "/api/v1/loyalty/points": {
          get: { operationId: "listLoyaltyPoints", tags: ["Loyalty"], responses: { "200": {} } },
        },
      }),
    });

    const { code, output } = run(["--reference", path]);

    expect(code).toBe(1);
    expect(output).toContain(
      "GET /api/v1/loyalty/points (listLoyaltyPoints) exists in the Medal API but not in the SDK document",
    );
    expect(output).not.toContain("[openapi-coverage] OK");
  });

  it("fails on a request enum the API narrowed differently", () => {
    const drifted = reference();
    const paths = drifted.paths as Record<string, Record<string, unknown>>;
    paths["/api/v1/deals"] = {
      post: {
        operationId: "createDeal",
        tags: ["Deals"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { currency: { type: "string", enum: ["NOK", "SEK"] } },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    };
    const path = write("enum-drift.json", drifted);

    const { code, output } = run(["--reference", path]);

    expect(code).toBe(1);
    expect(output).toContain("POST /api/v1/deals @ requestBody.currency enum drift");
    expect(output).toContain("API [NOK, SEK]");
  });

  it("fails when a request enum the API closes is an open string in the SDK", () => {
    const drifted = reference();
    const paths = drifted.paths as Record<string, Record<string, unknown>>;
    paths["/api/v1/contacts"] = {
      post: {
        operationId: "createContact",
        tags: ["Contacts"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                // `company` really is an open string in the SDK's own document,
                // so this is the "API closed it, the SDK did not" case rather
                // than a field the SDK is missing altogether.
                properties: { company: { type: "string", enum: ["acme", "medal"] } },
              },
            },
          },
        },
        responses: { "201": {} },
      },
    };
    const path = write("open-string.json", drifted);

    const { code, output } = run(["--reference", path]);

    expect(code).toBe(1);
    expect(output).toContain(
      "POST /api/v1/contacts @ requestBody.company is an open string in the SDK where the API accepts only [acme, medal]",
    );
  });

  it("refuses a reference that is not an OpenAPI document", () => {
    const path = write("not-a-spec.json", { operations: {} });
    const { code, output } = run(["--reference", path]);
    expect(code).toBe(1);
    expect(output).toContain("is not an OpenAPI document");
  });

  it("refuses a reference with too few v1 operations to mean anything", () => {
    const path = write("tiny.json", {
      openapi: "3.1.0",
      paths: {
        "/api/v1/contacts": {
          get: { operationId: "listContacts", tags: ["Contacts"], responses: { "200": {} } },
        },
      },
    });
    const { code, output } = run(["--reference", path]);
    expect(code).toBe(1);
    expect(output).toContain("refusing to call that parity");
  });
});

describe("scripts/assert-openapi-sdk-coverage.mjs — self-coverage failures", () => {
  it("fails when an SDK operation has no client call", () => {
    const spec = structuredClone(realSpec) as { paths: Record<string, unknown> };
    spec.paths["/api/v1/loyalty/points"] = {
      get: { operationId: "listLoyaltyPoints", tags: ["Loyalty"], responses: { "200": {} } },
    };
    const path = write("unreachable.json", spec);

    const { code, output } = run(["--spec", path]);

    expect(code).toBe(1);
    expect(output).toContain("has no this.client.* call in src/resources/");
  });

  it("fails when an operation is missing its operationId or tags", () => {
    const spec = structuredClone(realSpec) as { paths: Record<string, unknown> };
    spec.paths["/api/v1/posts"] = { get: { responses: { "200": {} } } };
    const path = write("no-operation-id.json", spec);

    const { code, output } = run(["--spec", path]);

    expect(code).toBe(1);
    expect(output).toContain("GET /api/v1/posts is missing an operationId");
    expect(output).toContain("GET /api/v1/posts is missing tags");
  });

  it("fails on a spec that is not OpenAPI 3.1", () => {
    const spec = { ...structuredClone(realSpec), openapi: "3.0.0" };
    const path = write("wrong-version.json", spec);
    const { code, output } = run(["--spec", path]);
    expect(code).toBe(1);
    expect(output).toContain("Expected openapi 3.1.0, got 3.0.0");
  });

  it("fails on a truncated spec instead of passing vacuously", () => {
    const path = write("truncated.json", {
      openapi: "3.1.0",
      jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
      paths: {},
    });
    const { code, output } = run(["--spec", path]);
    expect(code).toBe(1);
    expect(output).toContain("declares only 0 operations");
  });

  it("fails with a clear message when the bundled document is missing", () => {
    const { code, output } = run(["--spec", join(dir, "nope.json")]);
    expect(code).toBe(1);
    expect(output).toContain("Missing bundled OpenAPI document");
  });
});

describe("scripts/assert-openapi-sdk-coverage.mjs — the exceptions file", () => {
  it("fails on an exception that no longer matches anything", () => {
    const path = write("stale-exceptions.json", {
      no_client_method: [
        {
          op: "GET /api/v1/portal/vipps/callback",
          reason: "A public browser navigation, not an API call — nothing for a method to do.",
        },
      ],
      enum_locations: [
        {
          at: "GET /api/v1/contacts @ responses.200.data[].nickname",
          reason: "A field that has never existed, standing in for a waiver nobody removed.",
        },
      ],
    });

    const { code, output } = run(["--exceptions", path]);

    expect(code).toBe(1);
    expect(output).toContain("no longer matches anything — remove it");
  });

  it("fails on an exception with no real reason", () => {
    const path = write("reasonless-exceptions.json", {
      no_client_method: [{ op: "GET /api/v1/portal/vipps/callback", reason: "later" }],
    });

    const { code, output } = run(["--exceptions", path]);

    expect(code).toBe(1);
    expect(output).toContain("needs a reason of its own");
  });
});

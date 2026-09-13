#!/usr/bin/env node
/**
 * Two gates over the SDK's OpenAPI contract.
 *
 * 1. SELF-COVERAGE — every operation the SDK's own document declares is
 *    reachable from `src/resources/**`, with an operationId and a tag.
 * 2. API PARITY — every `/api/v1/**` operation (and every closed request enum)
 *    the MEDAL API's published document declares exists in the SDK's document
 *    too.
 *
 * The first check used to be the whole script, driven by a hand-written table
 * of 89 tuples: it compared the SDK to itself, so a route or an enum value
 * missing from BOTH the SDK's code and the SDK's document was invisible — which
 * is how the wrong deal statuses, the wrong contact statuses, the refused
 * portal locale and eight missing bookings/portal routes all shipped green
 * (audit SDK-1/2/3/6/7). The table is gone; the operation list is derived from
 * the document, and the second check is what makes the gate able to see a gap
 * at all.
 *
 * The reference is a SNAPSHOT of the API's surface, committed at
 * `openapi/reference/medal-api-v1-surface.json`, so the parity check runs on
 * every CI job in this repo with no access to the private monorepo. Refresh it
 * from a monorepo checkout (the SDK is a submodule there, so the file is
 * already on disk):
 *
 *   node scripts/assert-openapi-sdk-coverage.mjs \
 *     --reference-source ../../apps/web/src/lib/openapi-spec.ts \
 *     --write-reference openapi/reference/medal-api-v1-surface.json
 *   pnpm exec biome format --write openapi/reference/medal-api-v1-surface.json
 *
 * The second line is not optional: the snapshot is a committed file, so
 * `pnpm lint` formats it like any other JSON, and this script writes plain
 * `JSON.stringify(…, 2)` with no formatter of its own.
 *
 * and run the check straight against the live document — the strongest form,
 * because it also catches a stale snapshot — with:
 *
 *   node scripts/assert-openapi-sdk-coverage.mjs \
 *     --reference ../../apps/web/src/lib/openapi-spec.ts
 *
 * Known, reviewed differences live in `openapi/parity-exceptions.json`, each
 * with a reason. An exception that no longer matches anything is an ERROR, so
 * the file cannot quietly rot into a blanket waiver.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * @typedef {{ operationId: string | null, tags: string[], facts: Record<string, string[]> }} OperationSurface
 */

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch"]);
/** @type {Record<string, string[]>} Which `BaseClient` method may serve an OpenAPI method. */
const CLIENT_METHODS = {
  get: ["get"],
  post: ["post", "postOnce"],
  put: ["put"],
  patch: ["patch"],
  delete: ["delete"],
};
const RESOURCE_DIR = "src/resources";
const DEFAULT_SPEC = "dist/openapi/medal-social.openapi.json";
const DEFAULT_REFERENCE = "openapi/reference/medal-api-v1-surface.json";
const DEFAULT_EXCEPTIONS = "openapi/parity-exceptions.json";
/**
 * A floor on both documents, so an empty, truncated or wrong-shaped input
 * cannot pass by having nothing to check. Both sides carry ~100 operations; a
 * legitimate shrink past this is a deliberate act and a one-line edit here.
 */
const MIN_OPERATIONS = 50;

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const warnings = [];

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      errors.push(`--${key} needs a value`);
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

/**
 * Read a JSON file, or fail the run.
 * @param {string} path
 * @param {string} what
 * @returns {any}
 */
function readJson(path, what) {
  if (!existsSync(path)) {
    errors.push(`Missing ${what}: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Load an OpenAPI document from JSON, or from a TypeScript module that exports
 * it (the monorepo keeps its published document as `export const openapiSpec`).
 *
 * The module's imports are stripped and stubbed: the only thing they contribute
 * is the server URL, which the surface comparison never reads.
 *
 * @param {string} path
 * @param {string} what
 * @returns {Promise<any>}
 */
async function loadDocument(path, what) {
  if (/\.json$/i.test(path)) return readJson(path, what);
  if (!existsSync(path)) {
    errors.push(`Missing ${what}: ${path}`);
    return null;
  }
  const ts = await import("typescript");
  const source = readFileSync(path, "utf8");
  const compiled = ts.default.transpileModule(source, {
    compilerOptions: {
      module: ts.default.ModuleKind.ESNext,
      target: ts.default.ScriptTarget.ESNext,
    },
  }).outputText;
  /** @type {string[]} */
  const stubs = [];
  const stripped = compiled.replace(
    /^\s*import\s+([^;]*?)\s+from\s+['"][^'"]+['"];?\s*$/gm,
    (/** @type {string} */ _match, /** @type {string} */ clause) => {
      for (const binding of clause.replace(/[{}]/g, " ").split(",")) {
        const name = binding
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (name) stubs.push(name);
      }
      return "";
    },
  );
  const prelude = stubs
    .map((name) => `const ${name} = new Proxy({}, { get: () => "https://io.medalsocial.com" });`)
    .join("\n");
  const url = `data:text/javascript;base64,${Buffer.from(`${prelude}\n${stripped}`, "utf8").toString("base64")}`;
  const module = await import(url);
  const document = module.openapiSpec ?? module.default;
  if (!document?.paths) {
    errors.push(`${path} does not export an OpenAPI document (expected \`openapiSpec\`)`);
    return null;
  }
  return document;
}

/**
 * Resolve local `$ref`s, guarding against cycles.
 * @param {any} document
 * @returns {(node: any) => any}
 */
function makeResolver(document) {
  /** @type {Set<string>} */
  const active = new Set();
  /** @param {any} node @returns {any} */
  return function resolveNode(node) {
    if (!node || typeof node !== "object") return node;
    if (typeof node.$ref !== "string") return node;
    if (active.has(node.$ref)) return {};
    active.add(node.$ref);
    const segments = node.$ref.replace(/^#\//, "").split("/");
    let current = document;
    for (const segment of segments) {
      current = current?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    const resolved = resolveNode(current);
    active.delete(node.$ref);
    return resolved;
  };
}

/**
 * Record every string enum under a schema, plus the primitive type at each
 * location, keyed by a dotted property path (`requestBody.status`,
 * `responses.200.data[].kind`). The type entries are what tell an enum that is
 * merely ABSENT from one that is modelled as a different primitive.
 *
 * @param {any} schema
 * @param {(node: any) => any} resolveNode
 * @param {string} prefix
 * @param {Record<string, string[]>} out
 * @param {number} [depth]
 */
function collectSchemaFacts(schema, resolveNode, prefix, out, depth = 0) {
  if (depth > 8) return;
  const node = resolveNode(schema);
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node.enum)) {
    const values = node.enum
      .filter((/** @type {unknown} */ value) => typeof value === "string")
      .sort();
    if (values.length > 0) out[prefix] = values;
  } else if (typeof node.const === "string") {
    // `const: vipps` is a one-value enum in OpenAPI 3.1 — comparing it as a
    // plain string would report every single-value field as un-narrowed.
    out[prefix] = [node.const];
  } else if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    out[`${prefix}#type`] = types.includes("string") ? ["string"] : [String(types[0])];
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    for (const branch of node[key] ?? []) {
      collectSchemaFacts(branch, resolveNode, prefix, out, depth + 1);
    }
  }
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    collectSchemaFacts(child, resolveNode, prefix ? `${prefix}.${name}` : name, out, depth + 1);
  }
  if (node.items) collectSchemaFacts(node.items, resolveNode, `${prefix}[]`, out, depth + 1);
}

/**
 * The facts one operation carries: request parameters, request body, 2xx bodies.
 * @param {any} operation
 * @param {(node: any) => any} resolveNode
 */
function operationFacts(operation, resolveNode) {
  /** @type {Record<string, string[]>} */
  const facts = {};
  for (const parameter of operation.parameters ?? []) {
    const resolved = resolveNode(parameter);
    if (!resolved?.name || !resolved.schema) continue;
    collectSchemaFacts(resolved.schema, resolveNode, `parameters.${resolved.name}`, facts);
  }
  const body = resolveNode(operation.requestBody);
  const bodySchema = body?.content?.["application/json"]?.schema;
  if (bodySchema) collectSchemaFacts(bodySchema, resolveNode, "requestBody", facts);
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (!/^2\d\d$/.test(status)) continue;
    const schema = resolveNode(response)?.content?.["application/json"]?.schema;
    if (schema) collectSchemaFacts(schema, resolveNode, `responses.${status}`, facts);
  }
  return facts;
}

/**
 * `{ "GET /api/v1/contacts": { operationId, tags, facts } }` for one document.
 * @param {any} document
 * @param {(path: string) => boolean} [keepPath]
 * @returns {Map<string, OperationSurface>}
 */
function documentSurface(document, keepPath = () => true) {
  const resolveNode = makeResolver(document);
  /** @type {Map<string, OperationSurface>} */
  const surface = new Map();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!item || typeof item !== "object" || !keepPath(path)) continue;
    const shared = item.parameters ?? [];
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const merged = { ...operation, parameters: [...shared, ...(operation.parameters ?? [])] };
      surface.set(`${method.toUpperCase()} ${path}`, {
        operationId: operation.operationId ?? null,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        facts: operationFacts(merged, resolveNode),
      });
    }
  }
  return surface;
}

/**
 * The template literal a resource method would use for an OpenAPI path.
 * @param {string} path
 */
function clientPathNeedle(path) {
  return path.replace(
    /\{([^}]+)\}/g,
    (/** @type {string} */ _match, /** @type {string} */ name) => `\${encodeURIComponent(${name})}`,
  );
}

/** @type {Map<string, string>} */
const sourceCache = new Map();
function resourceSources() {
  if (sourceCache.size > 0) return sourceCache;
  const dir = resolve(RESOURCE_DIR);
  if (!existsSync(dir)) {
    errors.push(`${RESOURCE_DIR} does not exist`);
    return sourceCache;
  }
  // The listing is read rather than hard-coded so a new resource file needs no
  // edit here.
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    sourceCache.set(`${RESOURCE_DIR}/${name}`, readFileSync(resolve(dir, name), "utf8"));
  }
  return sourceCache;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does any resource file call the client for this method + path?
 * @param {string} method
 * @param {string} path
 */
function hasClientCall(method, path) {
  const needle = escapeRegExp(clientPathNeedle(path));
  const verbs = CLIENT_METHODS[method.toLowerCase()] ?? [];
  const pattern = new RegExp(
    `this\\.client\\.(?:${verbs.join("|")})(?:<[^>]*>)?\\(\\s*(["'\`])${needle}\\1`,
  );
  for (const source of resourceSources().values()) {
    if (pattern.test(source)) return true;
  }
  return false;
}

// ── run ───────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const EXCEPTIONS_FILE = args.exceptions ?? DEFAULT_EXCEPTIONS;

// ── exceptions ────────────────────────────────────────────────
const exceptions = existsSync(EXCEPTIONS_FILE)
  ? (readJson(EXCEPTIONS_FILE, "parity exceptions") ?? {})
  : {};
/** @type {Map<string, { reason: string, used: boolean }>} */
const exceptionIndex = new Map();
for (const group of ["no_client_method", "missing_from_sdk", "enum_locations"]) {
  for (const entry of exceptions[group] ?? []) {
    const key = `${group}:${entry.op ?? entry.at}`;
    if (!entry.reason || entry.reason.trim().length < 20) {
      errors.push(`${EXCEPTIONS_FILE}: ${key} needs a reason of its own (20+ characters)`);
    }
    exceptionIndex.set(key, { reason: entry.reason ?? "", used: false });
  }
}
/** @param {string} group @param {string} key */
function excused(group, key) {
  const entry = exceptionIndex.get(`${group}:${key}`);
  if (!entry) return false;
  entry.used = true;
  return true;
}

const specPath = args.spec ?? DEFAULT_SPEC;
const spec = await loadDocument(specPath, "bundled OpenAPI document (run `pnpm openapi:bundle`)");

if (spec) {
  if (spec.openapi !== "3.1.0") {
    errors.push(`Expected openapi 3.1.0, got ${spec.openapi ?? "<missing>"}`);
  }
  if (spec.jsonSchemaDialect !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push("Expected JSON Schema 2020-12 dialect declaration.");
  }
}

const sdkSurface = spec ? documentSurface(spec) : new Map();
if (spec && sdkSurface.size < MIN_OPERATIONS) {
  errors.push(
    `${specPath} declares only ${sdkSurface.size} operations (floor ${MIN_OPERATIONS}) — a truncated document would make every check below vacuous`,
  );
}

// 1. Self-coverage.
for (const [key, operation] of sdkSurface) {
  const [method, path] = key.split(" ");
  if (!operation.operationId) errors.push(`${key} is missing an operationId`);
  if (operation.tags.length === 0) errors.push(`${key} is missing tags`);
  if (hasClientCall(method, path)) continue;
  if (excused("no_client_method", key)) continue;
  errors.push(
    `${key} (${operation.operationId ?? "?"}) has no this.client.* call in ${RESOURCE_DIR}/ — add the method, or record it in ${EXCEPTIONS_FILE}`,
  );
}

// 2. Reference parity, or snapshot regeneration.
if (args["write-reference"]) {
  const sourcePath = args["reference-source"];
  if (!sourcePath) {
    errors.push("--write-reference needs --reference-source <api openapi document>");
  } else {
    const source = await loadDocument(sourcePath, "reference API document");
    if (source) {
      const surface = documentSurface(source, (path) => path.startsWith("/api/v1/"));
      /** @type {Record<string, { operationId: string | null, facts: Record<string, string[]> }>} */
      const operations = {};
      for (const [key, operation] of [...surface].sort(([a], [b]) => (a < b ? -1 : 1))) {
        operations[key] = { operationId: operation.operationId, facts: operation.facts };
      }
      const snapshot = {
        note: "Generated surface snapshot of the Medal API's published OpenAPI document — paths, methods and enums only. Refresh with `node scripts/assert-openapi-sdk-coverage.mjs --reference-source <monorepo>/apps/web/src/lib/openapi-spec.ts --write-reference openapi/reference/medal-api-v1-surface.json`.",
        generated_at: new Date().toISOString().slice(0, 10),
        source: sourcePath,
        operation_count: Object.keys(operations).length,
        operations,
      };
      const out = args["write-reference"];
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
      console.log(
        `[openapi-coverage] wrote ${Object.keys(operations).length} operations to ${out}`,
      );
    }
  }
} else {
  const referencePath = args.reference ?? DEFAULT_REFERENCE;
  /** @type {Record<string, { operationId?: string | null, facts?: Record<string, string[]> }> | null} */
  let referenceOperations = null;
  if (/\.json$/i.test(referencePath) && !args.reference) {
    const snapshot = readJson(referencePath, "API surface snapshot");
    referenceOperations = snapshot?.operations ?? null;
    if (snapshot && !snapshot.operations) {
      errors.push(`${referencePath} has no \`operations\` — regenerate it with --write-reference`);
    }
  } else {
    const document = await loadDocument(referencePath, "reference API document");
    if (document) {
      if (!document.paths || typeof document.paths !== "object") {
        errors.push(
          `${referencePath} is not an OpenAPI document (no \`paths\`) — pass the API's document, or drop --reference to use the committed snapshot`,
        );
      }
      referenceOperations = {};
      for (const [key, operation] of documentSurface(document, (path) =>
        path.startsWith("/api/v1/"),
      )) {
        referenceOperations[key] = { operationId: operation.operationId, facts: operation.facts };
      }
    }
  }

  if (referenceOperations && Object.keys(referenceOperations).length < MIN_OPERATIONS) {
    errors.push(
      `${referencePath} carries only ${Object.keys(referenceOperations).length} /api/v1 operations (floor ${MIN_OPERATIONS}) — refusing to call that parity`,
    );
  }

  if (referenceOperations) {
    for (const [key, reference] of Object.entries(referenceOperations)) {
      const sdkOperation = sdkSurface.get(key);
      if (!sdkOperation) {
        if (excused("missing_from_sdk", key)) continue;
        errors.push(
          `${key} (${reference.operationId ?? "?"}) exists in the Medal API but not in the SDK document`,
        );
        continue;
      }
      if (
        reference.operationId &&
        sdkOperation.operationId &&
        reference.operationId !== sdkOperation.operationId
      ) {
        // Advisory only: the ids are the API's own names for the operations and
        // the SDK's are part of its published generated types, so renaming
        // either is a deliberate, breaking act — not something a gate should
        // force.
        warnings.push(
          `${key} operationId differs — API "${reference.operationId}", SDK "${sdkOperation.operationId}"`,
        );
      }
      for (const [location, values] of Object.entries(reference.facts ?? {})) {
        if (location.endsWith("#type")) continue;
        const at = `${key} @ ${location}`;
        const mine = sdkOperation.facts[location];
        const myType = sdkOperation.facts[`${location}#type`]?.[0];
        const isRequest = location.startsWith("parameters.") || location.startsWith("requestBody");
        if (mine) {
          if (mine.join("|") === values.join("|")) continue;
          if (excused("enum_locations", at)) continue;
          errors.push(`${at} enum drift — API [${values.join(", ")}], SDK [${mine.join(", ")}]`);
          continue;
        }
        if (excused("enum_locations", at)) continue;
        if (myType && myType !== "string") {
          // Modelled as a different primitive (a boolean query flag against the
          // API's "true"/"1" string enum, say): compatible on the wire, so this
          // is a note rather than drift.
          warnings.push(`${at} is a ${myType} in the SDK where the API declares a string enum`);
          continue;
        }
        if (!myType) {
          if (isRequest) {
            errors.push(`${at} exists in the Medal API but not in the SDK document`);
          } else {
            warnings.push(`${at} exists in the Medal API but not in the SDK document`);
          }
          continue;
        }
        if (isRequest) {
          errors.push(
            `${at} is an open string in the SDK where the API accepts only [${values.join(", ")}]`,
          );
        } else {
          warnings.push(
            `${at} is an open string in the SDK where the API answers only [${values.join(", ")}]`,
          );
        }
      }
    }
  }

  for (const [key, entry] of exceptionIndex) {
    if (!entry.used) {
      errors.push(`${EXCEPTIONS_FILE}: ${key} no longer matches anything — remove it`);
    }
  }
}

if (warnings.length > 0) {
  console.warn(`[openapi-coverage] ${warnings.length} advisory difference(s):`);
  for (const warning of warnings) console.warn(`  ~ ${warning}`);
}

if (errors.length > 0) {
  console.error(`[openapi-coverage] FAIL — ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[openapi-coverage] OK — ${sdkSurface.size} SDK operations, all reachable from ${RESOURCE_DIR}/ and in parity with the Medal API surface.`,
);

#!/usr/bin/env node
/**
 * Idempotent JSR publish.
 *
 * `jsr publish` (which shells out to `deno publish`) is not safe to re-run: a
 * second attempt on an already-published version aborts the whole command. It
 * is also not atomic — the registry creates the version as soon as the tarball
 * is accepted, and only *then* does deno mint the Sigstore provenance
 * attestation. A transient failure from Fulcio or Rekor therefore exits
 * non-zero on a version that is already live and immutable, and re-running the
 * job cannot fix it.
 *
 * So: ask the registry first, and ask it again if the CLI fails.
 *
 *   pnpm jsr:publish              publish unless the version is already there
 *   pnpm jsr:publish --dry-run    report what it would do, publish nothing
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The package directory (packages/sdk) — where jsr.json sits and `jsr publish` runs.
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

/**
 * GitHub Actions renders `::warning::` as an annotation; elsewhere it is just a prefix.
 * @param {string} message
 */
const warn = (message) => {
  console.warn(`::warning::${message}`);
};

/** @returns {{ name: string, version: string }} */
const readJsrManifest = () => {
  const manifest = JSON.parse(readFileSync(new URL("../jsr.json", import.meta.url), "utf8"));
  if (!manifest.name || !manifest.version) {
    throw new Error('jsr.json is missing "name" or "version".');
  }
  return manifest;
};

/**
 * @param {string} name
 * @param {string} version
 * @returns {Promise<'published' | 'absent' | 'unknown'>}
 */
const versionState = async (name, version) => {
  const url = `https://jsr.io/${name}/${version}_meta.json`;
  let response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (error) {
    warn(`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return "unknown";
  }

  // Only the status matters here, but an unconsumed body holds its connection
  // open — and `main` can call this twice against the same endpoint. Pipe to a
  // sink rather than `cancel()`, which frees the socket by destroying the
  // connection instead of returning it to the pool; same reasoning as the
  // drain in `BaseClient.request`.
  await (response.body ? response.body.pipeTo(new WritableStream()) : response.text()).catch(
    () => {},
  );

  if (response.ok) {
    return "published";
  }
  if (response.status === 404) {
    return "absent";
  }
  warn(`Unexpected ${response.status} from ${url}`);
  return "unknown";
};

/** @returns {Promise<number>} the CLI's exit code */
const runJsrPublish = () =>
  new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "jsr", "publish"], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`[jsr-publish] failed to spawn jsr: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });

const main = async () => {
  const { name, version } = readJsrManifest();
  const label = `${name}@${version}`;
  const before = await versionState(name, version);

  if (before === "published") {
    console.log(`[jsr-publish] ${label} is already on JSR — nothing to publish.`);
    return 0;
  }

  if (dryRun) {
    console.log(
      `[jsr-publish] dry run: ${label} is ${before} on JSR; would run \`pnpm exec jsr publish\`.`,
    );
    return 0;
  }

  const code = await runJsrPublish();
  if (code === 0) {
    return 0;
  }

  // The CLI failed. If the registry has the version anyway, the upload landed
  // and only a post-upload step (almost always the Sigstore attestation) blew
  // up. The version is immutable, so failing the release here would leave a
  // permanently red job for something no re-run can repair.
  if ((await versionState(name, version)) === "published") {
    warn(
      `jsr publish exited ${code}, but ${label} is live on JSR. The upload succeeded and a post-upload step failed — most likely the Sigstore provenance attestation, which leaves the version without a transparency-log entry. Check https://jsr.io/${name}@${version} and re-attest manually if provenance is required.`,
    );
    return 0;
  }

  console.error(`[jsr-publish] ${label} was not published (exit ${code}).`);
  return code;
};

process.exitCode = await main();

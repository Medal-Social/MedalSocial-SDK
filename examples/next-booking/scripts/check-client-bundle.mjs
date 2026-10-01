/**
 * The size-budget table's `/next` row: server-only, so it must not appear in
 * any client chunk. After `next build`, every file under `.next/static` is
 * searched for strings only the server half contains — and for the API key.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATIC = new URL("../.next/static", import.meta.url).pathname;

/** Strings that exist only in `@medalsocial/booking/next` (and the key). */
const SERVER_ONLY = [
  "__medal-edge/booking-seed",
  "Booking API is not configured",
  "The Medal API key is not configured",
  "portal session expired",
  "sk_example",
];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.name.endsWith(".js")) yield path;
  }
}

/** Every chunk under `dir`, and the server-only strings found in each. */
async function scan(dir) {
  let checked = 0;
  const leaks = [];
  for await (const file of files(dir)) {
    checked += 1;
    const source = await readFile(file, "utf8");
    for (const marker of SERVER_ONLY) if (source.includes(marker)) leaks.push(`${file}: ${marker}`);
  }
  return { checked, leaks };
}

/**
 * `--self-test`: prove the gate can fail — a clean chunk passes, a chunk
 * carrying each marker is caught, and an empty directory is refused.
 */
async function selfTest() {
  const dir = await mkdtemp(join(tmpdir(), "check-client-bundle-"));
  try {
    await writeFile(join(dir, "clean.js"), 'console.log("hello");');
    const clean = await scan(dir);
    if (clean.checked !== 1 || clean.leaks.length !== 0) throw new Error("clean chunk flagged");
    for (const [index, marker] of SERVER_ONLY.entries()) {
      await writeFile(join(dir, `leak-${index}.js`), `const x = ${JSON.stringify(marker)};`);
    }
    const leaky = await scan(dir);
    if (leaky.leaks.length !== SERVER_ONLY.length) throw new Error("a marker went undetected");
    await rm(dir, { recursive: true });
    const empty = await mkdtemp(join(tmpdir(), "check-client-bundle-"));
    if ((await scan(empty)).checked !== 0) throw new Error("empty directory had chunks");
    await rm(empty, { recursive: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`[check-client-bundle] self-test OK — ${SERVER_ONLY.length} markers detected.`);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
  process.exit(0);
}

const { checked, leaks } = await scan(STATIC);
if (checked === 0) {
  console.error("[check-client-bundle] no client chunks found — run `next build` first");
  process.exit(1);
}
if (leaks.length > 0) {
  console.error(`[check-client-bundle] server code in client chunks:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`[check-client-bundle] OK — ${checked} client chunks, no server-only code or key.`);

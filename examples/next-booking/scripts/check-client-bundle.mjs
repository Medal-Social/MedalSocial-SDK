/**
 * The size-budget table's `/next` row: server-only, so it must not appear in
 * any client chunk. After `next build`, every file under `.next/static` is
 * searched for strings only the server half contains — and for the API key.
 */

import { readdir, readFile } from "node:fs/promises";
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

let checked = 0;
const leaks = [];
for await (const file of files(STATIC)) {
  checked += 1;
  const source = await readFile(file, "utf8");
  for (const marker of SERVER_ONLY) if (source.includes(marker)) leaks.push(`${file}: ${marker}`);
}

if (checked === 0) {
  console.error("[check-client-bundle] no client chunks found — run `next build` first");
  process.exit(1);
}
if (leaks.length > 0) {
  console.error(`[check-client-bundle] server code in client chunks:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`[check-client-bundle] OK — ${checked} client chunks, no server-only code or key.`);

#!/usr/bin/env node
// Verifies that every path declared in package.json (`main`, `module`,
// `types`, and `exports`) points at a file that actually exists on disk.
//
// Wired into `prepublishOnly` (after `tsup` build) so a publish FAILS if
// the package.json claims an entry point that the build doesn't produce.
//
// History: v1.1.4 shipped to npm with main/module/types/exports pointing at
// `dist/index.*` while tsup actually emits `dist/src/index.*`. Consumers
// had to apply postinstall patches to make the package resolvable. This
// script prevents that class of bug from recurring.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "..", "package.json");
const pkgDir = dirname(pkgPath);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

/** @type {string[]} */
const errors = [];

// Matches strings that look like a package-relative file path. We deliberately
// validate every string passed in (the caller controls call sites and only
// passes fields known to hold paths) but skip values that obviously aren't
// paths: URLs, bare specifiers, and conditional-export keys like "node" or
// "default" that show up when callers walk objects.
const PATH_LIKE = /^(\.\/|\.\.\/|\/|[a-zA-Z0-9_-]+\/).+\.[a-zA-Z0-9]+$/;

/**
 * @param {string} label
 * @param {unknown} value
 */
function check(label, value) {
  if (typeof value !== "string") return;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return; // protocol URL
  if (!PATH_LIKE.test(value)) return;
  const abs = resolve(pkgDir, value);
  if (!existsSync(abs)) {
    errors.push(`  ${label} → ${value}  (resolved: ${abs})`);
  }
}

/**
 * @param {unknown} node
 * @param {string} prefix
 */
function walkExports(node, prefix) {
  if (typeof node === "string") {
    check(prefix, node);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walkExports(value, `${prefix}["${key}"]`);
    }
  }
}

check("main", pkg.main);
check("module", pkg.module);
check("types", pkg.types);
if (pkg.exports) walkExports(pkg.exports, "exports");
if (Array.isArray(pkg.bin)) {
  pkg.bin.forEach((/** @type {unknown} */ v, /** @type {number} */ i) => {
    check(`bin[${i}]`, v);
  });
} else if (pkg.bin && typeof pkg.bin === "object") {
  for (const [key, value] of Object.entries(pkg.bin)) check(`bin["${key}"]`, value);
}

if (errors.length > 0) {
  console.error(
    `\n[verify-package-paths] FAIL — package.json declares ${errors.length} entry point(s) that don't exist:\n`,
  );
  for (const err of errors) console.error(err);
  console.error(
    "\nDid you forget to run `pnpm build`? Or did the tsup output paths drift from package.json?\n",
  );
  process.exit(1);
}

console.log("[verify-package-paths] OK — all package.json entry points resolve to existing files.");

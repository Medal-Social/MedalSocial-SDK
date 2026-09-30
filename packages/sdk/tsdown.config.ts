import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

const DTS_FILE = /\.d\.[cm]?ts$/;
const SOURCEMAP_COMMENT = /\n?\/\/# sourceMappingURL=\S+\s*$/;
const EXPORT_LIST = /^export \{/m;

// Tidies the bundled declaration files, working around two quirks of the
// tsgo → rolldown-plugin-dts pipeline (tsdown 0.23 / plugin 0.28):
//
// 1. A declaration file that carries its own code (pilot/index, the shared
//    chunks) keeps tsgo's inline `export declare function …` and gets no
//    `export {…}` list. A module .d.ts without one exports *every* top-level
//    declaration, so pilot's private zod schemas would leak as type exports
//    that do not exist at runtime. `export {};` switches that off.
// 2. The global `sourcemap: true` stamps a `sourceMappingURL` on those files
//    even though declaration maps are disabled, leaving dangling references.
//
// It runs on disk after the build rather than as a Rolldown plugin because
// tsdown does not pass user plugins to its separate CJS declaration build.
// Drop it once both are fixed upstream.
async function tidyDeclarations(outDir: string) {
  const files = await readdir(outDir, { recursive: true });
  await Promise.all(
    files
      .filter((file) => DTS_FILE.test(file))
      .map(async (file) => {
        const path = join(outDir, file);
        const before = await readFile(path, "utf8");
        let after = before.replace(SOURCEMAP_COMMENT, "\n");
        if (!EXPORT_LIST.test(after)) after += "export {};\n";
        if (after !== before) await writeFile(path, after);
      }),
  );
}

// Entry list lives here (not in the build script's CLI args) so tooling that
// reads the build config sees all three published entry points without needing
// dist/ to exist. Keys pin the output paths under dist/ that package.json's
// `exports` point at.
export default defineConfig({
  entry: {
    "src/index": "src/index.ts",
    "src/openapi.generated": "src/openapi.generated.ts",
    "pilot/index": "pilot/index.ts",
  },
  format: ["esm", "cjs"],
  // tsconfig.json is `src`-only for the typecheck gate; the build config adds
  // the ./pilot entry. Declaration maps were never shipped and still are not.
  dts: { tsconfig: "tsconfig.build.json", sourcemap: false },
  sourcemap: true,
  // Keep the published file names: CJS as .js/.d.ts, ESM as .mjs/.d.mts.
  // (tsdown's default would emit .cjs/.d.cts and break every `exports` path.)
  outExtensions: ({ format }) =>
    format === "cjs" ? { js: ".js", dts: ".d.ts" } : { js: ".mjs", dts: ".d.mts" },
  // Named exports only, exactly as before: do not rewrite a lone default
  // export into `module.exports`.
  cjsDefault: false,
  // package.json `exports` is hand-maintained and checked by verify:paths.
  exports: false,
  hooks: {
    "build:done": ({ options }) => tidyDeclarations(options.outDir),
  },
});

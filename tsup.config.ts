import { defineConfig } from "tsup";

// Entry list lives here (not in the build script's CLI args) so tooling that
// reads tsup config — knip's production-entry detection in particular — sees
// all three published entry points without needing dist/ to exist.
export default defineConfig({
  entry: ["src/index.ts", "src/openapi.generated.ts", "pilot/index.ts"],
  dts: true,
  format: ["esm", "cjs"],
  sourcemap: true,
});

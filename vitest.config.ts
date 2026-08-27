import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts", "pilot/**/*.{test,spec}.ts"],
    exclude: ["tests/integration.test.ts"],
    coverage: {
      provider: "v8",
      // lcov is what the Codecov upload step consumes; text/html are for humans.
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/types/**/*.ts",
        "src/devices/**/*.ts",
        "examples/**",
        "dist/**",
        "vitest.config.*",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});

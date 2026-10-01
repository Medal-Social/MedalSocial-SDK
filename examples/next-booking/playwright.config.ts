import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke: a built Next app on `next start`, talking to the mock Medal.
 * `pnpm build` first (CI does); this config only starts the two servers.
 */
const env = {
  MEDAL_API_KEY: "sk_example",
  MEDAL_API_ENDPOINT: "http://localhost:3101",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node mock-medal/server.mjs",
      url: "http://localhost:3101/health",
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      // The mock answers 401 without the key, which is still «up».
      timeout: 30_000,
    },
    {
      command: "pnpm exec next start --port 3100",
      url: "http://localhost:3100",
      env,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

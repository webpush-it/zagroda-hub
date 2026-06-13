import { defineConfig, devices } from "@playwright/test";

// E2E harness for the BUILT Cloudflare Worker on a phone viewport.
//
// Serve target is `wrangler dev` (workerd, :8787), NOT `astro dev`/`astro preview`
// — only the built Worker is faithful under the @astrojs/cloudflare adapter.
// `npm run build` is a HARD prerequisite: `wrangler dev` serves whatever is in
// dist/, so a stale build silently tests old code. The `webServer` below does
// NOT build — use `npm run test:e2e` (build && playwright test) or build first.
//
// globalSetup resolves the local Supabase stack and writes `.dev.vars` (which
// `wrangler dev` reads) BEFORE the server starts. fullyParallel is off because
// all specs share one local DB (mirrors vitest's fileParallelism:false).

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "Pixel 5",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npx wrangler dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Generous: workerd cold start + binding wiring. Build is excluded (it is the
    // documented prerequisite), so this timeout covers only `wrangler dev` boot.
    timeout: 120_000,
  },
});

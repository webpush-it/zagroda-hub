import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit the local Supabase stack (no jsdom — node environment).
// Files share one database, so file-level parallelism is off; the concurrency
// test orchestrates its own parallel RPC calls within a single file.
export default defineConfig({
  // Mirror tsconfig's `@/*` → `./src/*` so unit tests can import src modules
  // that use the alias for runtime (not just type-only) imports.
  // The two `astro:` aliases resolve the only virtual modules used by the API
  // surface, so tests/api/ can import real handlers + middleware in node:
  // astro:middleware → the package's real defineMiddleware/sequence exports;
  // astro:env/server → a test stub wired to the local Supabase credentials.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "astro:middleware": "astro/virtual-modules/middleware.js",
      "astro:env/server": fileURLToPath(new URL("./tests/helpers/astro-env.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: "tests/helpers/global-setup.ts",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit the local Supabase stack (no jsdom — node environment).
// Files share one database, so file-level parallelism is off; the concurrency
// test orchestrates its own parallel RPC calls within a single file.
export default defineConfig({
  // Mirror tsconfig's `@/*` → `./src/*` so unit tests can import src modules
  // that use the alias for runtime (not just type-only) imports.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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

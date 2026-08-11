import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from vitest.config.mjs on purpose: these tests hit a real
// (disposable, branched) Postgres database and must never run as part of
// `npm test` / `npm run test:critical` / CI, which have no DB secret and are
// documented (CRITICAL_TESTING.md) to never touch a database at all.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.js"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 20_000,
    setupFiles: ["tests/integration/setup.js"],
    // Real Postgres row locks are the entire point — concurrent test files
    // sharing one connection pool would defeat that, so keep it to one.
    fileParallelism: false,
  },
});

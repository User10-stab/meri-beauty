import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/critical/**/*.test.js"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});

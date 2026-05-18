import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Individual tests should finish quickly, but stack startup can take much longer
    // on cold/slow Docker runs due to image pull/build and multiple readiness probes.
    testTimeout: 5 * 60_000,
    hookTimeout: 12 * 60_000,
  },
});

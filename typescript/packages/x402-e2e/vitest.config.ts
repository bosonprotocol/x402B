import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Docker boot + contract + subgraph readiness can take 2–5 min on a cold pull.
    testTimeout: 5 * 60_000,
    hookTimeout: 5 * 60_000,
  },
});

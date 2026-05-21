import { defineConfig } from "vitest/config";

// Debug fallback: set `E2E_SEQUENTIAL=1` to disable cross-file
// parallelism. The suite is designed to be parallel-safe via
// per-file seed-wallet slots (see `test/scenarios/_seed-wallets.ts`);
// this knob exists only as an escape hatch when debugging suspected
// chain-state interactions across files.
const SEQUENTIAL = process.env.E2E_SEQUENTIAL === "1";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Individual tests should finish quickly, but stack startup can take much longer
    // on cold/slow Docker runs due to image pull/build and multiple readiness probes.
    testTimeout: 5 * 60_000,
    hookTimeout: 12 * 60_000,
    // `globalSetup` is gated internally on `E2E_DOCKER=1`; when that flag
    // is off, the setup is a no-op and the docker-dependent scenarios
    // skip themselves via `describe.skipIf(...)`. Listing the setup
    // unconditionally keeps a single source of truth for the scenario
    // wiring — flipping the gate runs the suite end-to-end without any
    // config change.
    globalSetup: ["./test/setup/globalSetup.ts"],
    ...(SEQUENTIAL ? { fileParallelism: false } : {}),
  },
});

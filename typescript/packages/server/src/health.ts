// Health-check helper bound to a configured server. Probes the
// facilitator's `/healthz` endpoint and a cheap subgraph read; hosts
// mount the resulting `healthCheck()` behind whatever framework-level
// `/healthz` / `/readyz` route they use. Framework-free on purpose —
// the SDK doesn't dictate Express vs Hono vs Lambda.

import type { CoreSdkReadAdapter } from "./onchain/core-sdk-read.js";
import type { FacilitatorClient } from "./facilitator/client.js";

/**
 * Per-dependency health status.
 *
 * - `"ok"` — last probe succeeded
 * - `"down"` — last probe threw or returned a non-2xx
 * - `"n/a"` — dependency isn't configured (subgraph is optional —
 *   commit/redeem-only servers don't have one)
 */
export type HealthState = "ok" | "down" | "n/a";

export interface HealthCheckResult {
  facilitator: HealthState;
  subgraph: HealthState;
}

/** Build a `healthCheck()` function bound to a facilitator client + optional read client. */
export function createHealthCheck(deps: {
  facilitator: FacilitatorClient;
  coreSdkRead?: CoreSdkReadAdapter | (() => CoreSdkReadAdapter | undefined);
}): () => Promise<HealthCheckResult> {
  return async () => {
    const facilitator: HealthState = (await probe(() => deps.facilitator.healthCheck()))
      ? "ok"
      : "down";

    const readClient =
      typeof deps.coreSdkRead === "function" ? deps.coreSdkRead() : deps.coreSdkRead;
    const subgraph: HealthState =
      readClient === undefined
        ? "n/a"
        : (await probe(() => readClient.getSellersByAddress(ZERO_ADDRESS_PROBE)))
          ? "ok"
          : "down";

    return { facilitator, subgraph };
  };
}

async function probe(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

// Cheap subgraph probe query — `getSellersByAddress(0x0)` returns an
// empty array on a healthy subgraph, throws on a downed indexer.
const ZERO_ADDRESS_PROBE = "0x0000000000000000000000000000000000000000";

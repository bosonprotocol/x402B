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
 *   commit/redeem-only servers don't have one). For the subgraph
 *   probe, `"n/a"` means **neither** `coreSdkRead` nor `subgraphUrl`
 *   was supplied; a configured `subgraphUrl` is materialised on the
 *   first probe so it always reports `"ok"` / `"down"`.
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

    // Resolve the read client through the factory variant inside a
    // try/catch so a synchronous throw (e.g. a lazy initializer that
    // can't reach its subgraph) reports "down" instead of rejecting
    // the whole health check. A factory that legitimately returns
    // `undefined` maps to "n/a" — `createX402bServer`'s factory only
    // returns `undefined` when neither `coreSdkRead` nor `subgraphUrl`
    // is configured.
    let readClient: CoreSdkReadAdapter | undefined;
    let readClientFailed = false;
    if (typeof deps.coreSdkRead === "function") {
      try {
        readClient = deps.coreSdkRead();
      } catch {
        readClientFailed = true;
      }
    } else {
      readClient = deps.coreSdkRead;
    }
    const subgraph: HealthState = readClientFailed
      ? "down"
      : readClient === undefined
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

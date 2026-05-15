// Build a per-seller `ChannelRegistry` for the example. Advertises
// `server`, `facilitator`, and `onchain` channels, stamps every
// `POST /x402B/*` route under `RESOURCE_SERVER_URL` as the
// `server`-channel endpoint for the corresponding action id, and pins
// the registry to the configured Boson Diamond.
//
// The registry is consumed by `@bosonprotocol/x402-server`'s
// `deriveNextActions` — actions absent from `endpoints` will not
// advertise a `server` channel even when `server` is listed in
// `channels`, so the map below mirrors the routes `mountX402b`
// installs in `@bosonprotocol/x402-server-express`. `boson-cancelVoucher`
// and `boson-revokeVoucher` are intentionally absent: `mountX402b` does
// not expose routes for them yet, so they only travel on the
// `facilitator` / `onchain` channels.

import type { ChannelRegistry } from "@bosonprotocol/x402-actions";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

import type { ResourceServerEnv } from "./config.js";

/** Path segments mirror `mountX402b` in `@bosonprotocol/x402-server-express`. */
const ROUTE_FOR_ACTION: Partial<Record<ActionId, string>> = {
  "boson-createOfferAndCommit": "/x402B/commit",
  "boson-createOfferCommitAndRedeem": "/x402B/commit-and-redeem",
  "boson-redeem": "/x402B/redeem",
  "boson-completeExchange": "/x402B/complete",
  "boson-raiseDispute": "/x402B/dispute/raise",
  "boson-resolveDispute": "/x402B/dispute/resolve",
  "boson-retractDispute": "/x402B/dispute/retract",
  "boson-escalateDispute": "/x402B/dispute/escalate",
  "boson-withdrawFunds": "/x402B/withdraw-funds",
};

export function buildExampleChannelRegistry(env: ResourceServerEnv): ChannelRegistry {
  const base = env.publicUrl.replace(/\/+$/, "");
  const endpoints: Partial<Record<ActionId, string>> = {};
  for (const [action, path] of Object.entries(ROUTE_FOR_ACTION) as [ActionId, string][]) {
    endpoints[action] = `${base}${path}`;
  }
  return {
    channels: ["server", "facilitator", "onchain"],
    endpoints,
    escrow: env.escrowAddress,
  };
}

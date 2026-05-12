// `FacilitatorChannelAdapter` — implements `@bosonprotocol/x402-actions`'s
// `ChannelAdapter` contract for the `"facilitator"` channel.
//
// One `nextAction` entry can be invoked through multiple channels. This
// adapter populates `endpoints.facilitator` with the URL the client
// should POST to:
//
//   - commit-time actions (`boson-createOfferAndCommit`,
//     `boson-createOfferCommitAndRedeem`) → `${url}/settle`.
//   - post-commit actions (`boson-redeem`, `boson-completeExchange`,
//     `boson-cancelVoucher`, `boson-revokeVoucher`,
//     `boson-raiseDispute`, `boson-retractDispute`,
//     `boson-escalateDispute`, `boson-resolveDispute`)
//     → `${url}/perform-action?action=${action}`.
//
// Source of truth for the channel id and the adapter shape:
// `@bosonprotocol/x402-actions/channels`.

import type { ChannelAdapter } from "@bosonprotocol/x402-actions/channels";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";

/** Per-server configuration for the facilitator channel adapter. */
export interface FacilitatorChannelConfig {
  /** Public URL the facilitator service is reachable at, without a trailing slash. */
  url: string;
}

const COMMIT_ACTIONS: ReadonlySet<ActionId> = new Set([
  "boson-createOfferAndCommit",
  "boson-createOfferCommitAndRedeem",
]);

export class FacilitatorChannelAdapter implements ChannelAdapter<FacilitatorChannelConfig> {
  readonly channel = "facilitator" as const;

  describe(action: ActionId, cfg: FacilitatorChannelConfig): { endpoint: string } | undefined {
    if (COMMIT_ACTIONS.has(action)) {
      return { endpoint: `${cfg.url}/settle` };
    }
    return { endpoint: `${cfg.url}/perform-action?action=${action}` };
  }
}

// Build an `UnsignedFullOffer` from env values + sane defaults.
//
// The `FullOffer` struct carried by the BPIP-10 EIP-712 typed-data is
// large (~30 fields, several nested sub-structs); most fields don't
// vary per request in this example. We only env-drive what's typically
// configurable per offer (price, asset, seller identity, dispute
// resolver) and pin the rest to reasonable defaults that work against
// a local Boson stack. See the JSDoc on `buildUnsignedOffer` below for
// the timing model and how to adapt each window when forking; other
// fields (`metadataUri`, `royaltyInfo`, …) should be swapped to match
// the catalogue.

import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type { Address } from "viem";

import type { ResourceServerEnv } from "./config.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface BuildOfferArgs {
  env: ResourceServerEnv;
  /** Seller address that signs the offer. Used as `offerCreator`. */
  sellerAddress: Address;
  /** Wall-clock time to anchor offer validity windows. Injectable for tests. */
  now?: number;
}

/**
 * Build an unsigned FullOffer with demo-friendly defaults.
 *
 * ## Time units
 *
 * Every `*InMS` field is in **milliseconds** — the core-sdk wire
 * convention. The SDK converts to seconds internally for the on-chain
 * ABI (`IBosonOfferHandler` and friends), so do not pre-convert. See
 * {@link https://github.com/bosonprotocol/core-components/blob/main/packages/common/src/types/offers.ts core-sdk offer types}
 * and {@link https://github.com/bosonprotocol/boson-protocol-contracts/blob/main/contracts/interfaces/handlers/IBosonOfferHandler.sol IBosonOfferHandler}.
 *
 * ## Two independent windows
 *
 * An exchange is governed by two windows that are intentionally
 * decoupled — a buyer may commit on the last second of the offer
 * window and still have the full redemption window ahead of them.
 *
 * - **Offer validity** — `validFromDateInMS` … `validUntilDateInMS`.
 *   When the offer is *committable*. After `validUntilDateInMS`, no
 *   new commits land. Bound to the offer.
 * - **Voucher redemption** — `voucherRedeemableFromDateInMS` …
 *   *either* `voucherRedeemableUntilDateInMS` *or*
 *   `voucherValidDurationInMS`. When a committed voucher can be
 *   *redeemed*. Bound to the exchange that the commit produced.
 *
 * **Protocol invariant (enforced on-chain):** exactly one of
 * `voucherRedeemableUntilDateInMS` and `voucherValidDurationInMS`
 * must be non-zero.
 *
 * - **Absolute deadline** (used in this example) — set
 *   `voucherRedeemableUntilDateInMS` to a fixed timestamp and leave
 *   `voucherValidDurationInMS` at `"0"`. Every buyer's redemption
 *   deadline lands at the same wall-clock moment. Right for
 *   fixed-date events (concert tickets, scheduled drops).
 * - **Sliding window** — set `voucherRedeemableUntilDateInMS` to
 *   `"0"` and `voucherValidDurationInMS` to a duration. The
 *   redemption window then closes at
 *   `commitTime + voucherValidDurationInMS`. Right for evergreen
 *   catalogues ("redeemable for 30 days after commit, whenever you
 *   commit").
 *
 * ## Dispute / resolution durations
 *
 * `disputePeriodDurationInMS` runs from redemption — how long the
 * buyer has to raise a dispute. `resolutionPeriodDurationInMS` runs
 * from dispute-raised — how long both sides have to resolve mutually
 * before escalation paths open. Both are *baked into the exchange at
 * commit* and cannot be extended, so over-provision rather than
 * under-provision when forking.
 *
 * ## Customising for your catalogue
 *
 * The demo uses deliberately short windows (offer 1 h, redemption 1 h,
 * dispute 1 d, resolution 1 w) so e2e runs finish quickly. Real
 * catalogues should widen all four to whatever fits the product. The
 * only hard constraints are the validation rules in
 * `IBosonOfferHandler` and core-sdk's `CreateOfferArgs`:
 *
 * - `validFromDateInMS < validUntilDateInMS`, and `validUntilDateInMS`
 *   must be in the future at submission time.
 * - `voucherRedeemableFromDateInMS < voucherRedeemableUntilDateInMS`
 *   when the absolute form is used.
 * - `buyerCancelPenalty <= price`.
 */
export function buildUnsignedOffer({ env, sellerAddress, now }: BuildOfferArgs): UnsignedFullOffer {
  const t = now ?? Date.now();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;

  return {
    price: env.amount,
    sellerDeposit: "0",
    agentId: "0",
    buyerCancelPenalty: "0",
    quantityAvailable: "1",
    validFromDateInMS: String(t),
    validUntilDateInMS: String(t + oneHour),
    voucherRedeemableFromDateInMS: String(t),
    voucherRedeemableUntilDateInMS: String(t + oneHour),
    disputePeriodDurationInMS: String(oneDay),
    voucherValidDurationInMS: "0",
    resolutionPeriodDurationInMS: String(oneWeek),
    exchangeToken: env.assetAddress,
    disputeResolverId: env.disputeResolverId,
    metadataUri: "ipfs://x402b-example",
    metadataHash: "x402b-example",
    collectionIndex: "0",
    feeLimit: "0",
    offerCreator: sellerAddress,
    committer: ZERO_ADDRESS,
    condition: {
      method: 0,
      tokenType: 0,
      tokenAddress: ZERO_ADDRESS,
      gatingType: 0,
      minTokenId: "0",
      threshold: "0",
      maxCommits: "0",
      maxTokenId: "0",
    },
    useDepositedFunds: false,
    sellerId: env.sellerId,
    buyerId: "0",
    sellerOfferParams: {
      collectionIndex: "0",
      royaltyInfo: { recipients: [], bps: [] },
      mutualizerAddress: ZERO_ADDRESS,
    },
  } satisfies UnsignedFullOffer;
}

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
import type { ProtocolConfig } from "./protocol-config.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface BuildOfferArgs {
  env: ResourceServerEnv;
  /** Seller address that signs the offer. Used as `offerCreator`. */
  sellerAddress: Address;
  /** Wall-clock time to anchor offer validity windows. Injectable for tests. */
  now?: number;
  /**
   * Per-request session id — folded into `metadataUri` / `metadataHash`
   * so concurrent buyers (each with a distinct session id) never
   * produce byte-identical `UnsignedFullOffer` structs. Without this
   * salt, two requests hitting the server within the same millisecond
   * share `validFromDateInMS` and every other field, the seller signs
   * the same offer twice, and the second commit reverts `OfferSoldOut`
   * on the single-quantity template. Defaults to `"no-session"` for
   * callers that don't track sessions.
   */
  sessionId?: string;
  /**
   * On-chain `ConfigHandlerFacet` slice — when supplied, the builder
   * tightens `feeLimit` and floors `disputePeriodDurationInMS` against
   * the actual on-chain values instead of using the conservative
   * defaults. Forks should fetch this via `fetchProtocolConfig` at
   * boot and pass it in. The unit-test friendly safe defaults stay
   * in place when omitted.
   */
  protocolConfig?: ProtocolConfig;
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
 * The defaults below are deliberately wide — offer + redemption open
 * 1 day in the past and run 30 days into the future. Two reasons:
 *
 * 1. **Local-stack chain-time drift tolerance.** Hardhat under
 *    interval mining advances `block.timestamp` 1 s per block, so at
 *    a 50 ms interval chain time runs ~20× wall-clock. A 1-hour
 *    validity window expires in ~3 min of wall-clock; a 30-day
 *    window survives any realistic suite run.
 * 2. **Drop-in for varied catalogue lifetimes.** Real catalogues
 *    pick whatever fits the product; "30 days" is a sane upper
 *    default that won't surprise demos.
 *
 * Forks can narrow these to fit their flow — the only hard
 * constraints are the validation rules in `IBosonOfferHandler` and
 * core-sdk's `CreateOfferArgs`:
 *
 * - `validFromDateInMS < validUntilDateInMS`, and `validUntilDateInMS`
 *   must be in the future at submission time.
 * - `voucherRedeemableFromDateInMS < voucherRedeemableUntilDateInMS`
 *   when the absolute form is used.
 * - `buyerCancelPenalty <= price`.
 */
export function buildUnsignedOffer({
  env,
  sellerAddress,
  now,
  sessionId,
  protocolConfig,
}: BuildOfferArgs): UnsignedFullOffer {
  const t = now ?? Date.now();
  const salt = sessionId ?? "no-session";
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;
  const thirtyDays = 30 * oneDay;

  // `disputePeriodDurationInMS`: prefer the demo's 1-week target but
  // floor it against the protocol's `getMinDisputePeriod()` when the
  // caller supplied a `protocolConfig`. Without the on-chain value
  // we keep 1 week as the safe upper bound; the local
  // `boson-protocol-node` enforces the minimum via
  // `InvalidDisputePeriod`, so any value below it would revert.
  const desiredDisputePeriodMs = oneWeek;
  const disputePeriodDurationInMS =
    protocolConfig === undefined
      ? desiredDisputePeriodMs
      : Math.max(desiredDisputePeriodMs, protocolConfig.minDisputePeriodMs);

  // `feeLimit` is an absolute uint256 in payment-asset units. The
  // worst case the protocol can charge is `price * maxFeeBps /
  // 10000`; setting `feeLimit` to exactly that absorbs the full
  // on-chain fee without leaving the seller exposed to a future
  // `getMaxTotalOfferFeePercentage` bump. When the on-chain cap
  // isn't known, fall back to the previous demo behaviour of
  // accepting up to the entire price (worst case: zero net revenue).
  const feeLimit =
    protocolConfig === undefined
      ? env.amount
      : ((BigInt(env.amount) * BigInt(protocolConfig.maxOfferFeeBps)) / 10000n).toString();

  return {
    price: env.amount,
    sellerDeposit: "0",
    agentId: "0",
    buyerCancelPenalty: "0",
    quantityAvailable: "1",
    validFromDateInMS: String(t - oneDay),
    validUntilDateInMS: String(t + thirtyDays),
    voucherRedeemableFromDateInMS: String(t - oneDay),
    voucherRedeemableUntilDateInMS: String(t + thirtyDays),
    disputePeriodDurationInMS: String(disputePeriodDurationInMS),
    voucherValidDurationInMS: "0",
    resolutionPeriodDurationInMS: String(oneWeek),
    exchangeToken: env.assetAddress,
    disputeResolverId: env.disputeResolverId,
    metadataUri: `ipfs://x402b-example/${salt}`,
    metadataHash: `x402b-example-${salt}`,
    collectionIndex: "0",
    feeLimit,
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

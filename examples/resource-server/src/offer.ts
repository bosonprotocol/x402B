// Build an `UnsignedFullOffer` from env values + sane defaults.
//
// The `FullOffer` struct carried by the BPIP-10 EIP-712 typed-data is
// large (~30 fields, several nested sub-structs); most fields don't
// vary per request in this example. We only env-drive what's typically
// configurable per offer (price, asset, seller identity, dispute
// resolver) and pin the rest to reasonable defaults that work against
// a local Boson stack. Integrators forking this example should adapt
// `metadataUri` / `validUntil` / `royaltyInfo` etc. to their catalogue.

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
  } as UnsignedFullOffer;
}

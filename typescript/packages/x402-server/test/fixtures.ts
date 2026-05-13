// Shared test fixtures — kept narrow so test files stay easy to read.
// FullOffer shape mirrors `core`'s own `eip712/full-offer.test.ts` so
// the round-trip behaviour is comparable.

import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";

export const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
export const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const SELLER = "0x1111111111111111111111111111111111111111" as const;
export const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Deterministic test key — 32 bytes of `0x22`. Recovers to `0x9b87...` etc.; we read the address back from `privateKeyToAccount`. */
export const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;

/** A valid `UnsignedFullOffer` — matches the protocol's struct shape. */
export const baseOffer: UnsignedFullOffer = {
  price: "1000000",
  sellerDeposit: "0",
  agentId: "0",
  buyerCancelPenalty: "0",
  quantityAvailable: "1",
  validFromDateInMS: "1900000000000",
  validUntilDateInMS: "1900003600000",
  voucherRedeemableFromDateInMS: "1900000000000",
  voucherRedeemableUntilDateInMS: "1900003600000",
  disputePeriodDurationInMS: "86400000",
  voucherValidDurationInMS: "0",
  resolutionPeriodDurationInMS: "604800000",
  exchangeToken: TOKEN,
  disputeResolverId: "1",
  metadataUri: "ipfs://QmDeadBeef",
  metadataHash: "QmDeadBeef",
  collectionIndex: "0",
  feeLimit: "0",
  offerCreator: SELLER,
  committer: ZERO,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: ZERO,
    gatingType: 0,
    minTokenId: "0",
    threshold: "0",
    maxCommits: "0",
    maxTokenId: "0",
  },
  useDepositedFunds: false,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: ZERO,
  },
};

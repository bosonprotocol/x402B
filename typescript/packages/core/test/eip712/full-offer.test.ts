import { describe, expect, it } from "vitest";
import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  fullOfferTypedData,
  hashFullOffer,
  recoverFullOfferSigner,
  type UnsignedFullOffer,
} from "../../src/eip712/index.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const SELLER = "0x1111111111111111111111111111111111111111" as const;
const BUYER_PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;

const TEST_PRIVATE_KEY = `0x${"22".repeat(32)}` as const;

const baseOffer: UnsignedFullOffer = {
  // CreateOfferArgs
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
  // FullOffer-only
  offerCreator: SELLER,
  committer: BUYER_PLACEHOLDER,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: "0x0000000000000000000000000000000000000000",
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
    mutualizerAddress: "0x0000000000000000000000000000000000000000",
  },
};

describe("fullOfferTypedData (wraps core-sdk's signFullOffer)", () => {
  it("returns FullOffer-typed EIP-712 data with the salt-based domain", async () => {
    const td = await fullOfferTypedData({
      fullOffer: baseOffer,
      verifyingContract: ESCROW,
      chainId: 8453,
    });
    expect(td.primaryType).toBe("FullOffer");
    expect(td.domain).toMatchObject({
      name: "Boson Protocol",
      version: "V2",
      verifyingContract: ESCROW,
      salt: numberToHex(8453, { size: 32 }),
    });
    expect(td.domain).not.toHaveProperty("chainId");
  });

  it("types include the FullOffer struct and its nested types", async () => {
    const td = await fullOfferTypedData({
      fullOffer: baseOffer,
      verifyingContract: ESCROW,
      chainId: 8453,
    });
    expect(td.types).toHaveProperty("FullOffer");
    expect(td.types).toHaveProperty("Offer");
    expect(td.types).toHaveProperty("OfferDates");
    expect(td.types).toHaveProperty("OfferDurations");
    expect(td.types).toHaveProperty("DRParameters");
    expect(td.types).toHaveProperty("Condition");
    expect(td.types).toHaveProperty("RoyaltyInfo");
    expect(td.types).toHaveProperty("EIP712Domain");
  });
});

describe("hashFullOffer + recoverFullOfferSigner round-trip", () => {
  it("recovers the signing seller", async () => {
    const seller = privateKeyToAccount(TEST_PRIVATE_KEY);
    const td = await fullOfferTypedData({
      fullOffer: { ...baseOffer, offerCreator: seller.address },
      verifyingContract: ESCROW,
      chainId: 8453,
    });
    const signature = await seller.signTypedData(td);
    const recovered = await recoverFullOfferSigner({
      fullOffer: { ...baseOffer, offerCreator: seller.address },
      verifyingContract: ESCROW,
      chainId: 8453,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(seller.address.toLowerCase());
  });

  it("hash is deterministic and 32 bytes", async () => {
    const args = { fullOffer: baseOffer, verifyingContract: ESCROW, chainId: 8453 };
    const h1 = await hashFullOffer(args);
    const h2 = await hashFullOffer(args);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hash differs across chains", async () => {
    const onBase = await hashFullOffer({
      fullOffer: baseOffer,
      verifyingContract: ESCROW,
      chainId: 8453,
    });
    const onPolygon = await hashFullOffer({
      fullOffer: baseOffer,
      verifyingContract: ESCROW,
      chainId: 137,
    });
    expect(onBase).not.toBe(onPolygon);
  });
});

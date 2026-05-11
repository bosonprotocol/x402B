import { describe, expect, it } from "vitest";
import type { FullOfferArgs } from "@bosonprotocol/common";
import { exchanges } from "@bosonprotocol/core-sdk";

import { buildCreateOfferAndCommitCalldata } from "../../src/actions/create-offer-and-commit.js";

// Pinned literal core-sdk uses internally for `signMetaTxCreateOfferAndCommit`.
// If this assertion fails, the EIP-712 meta-tx hash will recover to the
// wrong address on-chain — investigate before "fixing" the test.
const EXPECTED_FUNCTION_NAME =
  "createOfferAndCommit(((uint256,uint256,uint256,uint256,uint256,uint256,address,uint8,uint8,string,string,bool,uint256,(address[],uint256[])[],uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256),(uint256,address),(uint8,uint8,address,uint8,uint256,uint256,uint256,uint256),uint256,uint256,bool),address,address,bytes,uint256,(uint256,(address[],uint256[]),address))";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const SELLER = "0x1111111111111111111111111111111111111111" as const;
const BUYER = "0x2222222222222222222222222222222222222222" as const;
const DUMMY_SIG = `0x${"33".repeat(65)}`;

const baseOffer: FullOfferArgs = {
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
  committer: BUYER,
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
  signature: DUMMY_SIG,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: "0x0000000000000000000000000000000000000000",
  },
};

describe("buildCreateOfferAndCommitCalldata", () => {
  it("returns the pinned functionName literal core-sdk hashes against", () => {
    const out = buildCreateOfferAndCommitCalldata({ fullOffer: baseOffer });
    expect(out.functionName).toBe(EXPECTED_FUNCTION_NAME);
  });

  it("functionSignature byte-matches core-sdk's exchanges.iface.encodeCreateOfferAndCommit", () => {
    const out = buildCreateOfferAndCommitCalldata({ fullOffer: baseOffer });
    expect(out.functionSignature).toBe(exchanges.iface.encodeCreateOfferAndCommit(baseOffer));
  });

  it("emits a 0x-prefixed lowercase hex string", () => {
    const out = buildCreateOfferAndCommitCalldata({ fullOffer: baseOffer });
    expect(out.functionSignature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("is deterministic for fixed inputs", () => {
    const a = buildCreateOfferAndCommitCalldata({ fullOffer: baseOffer });
    const b = buildCreateOfferAndCommitCalldata({ fullOffer: baseOffer });
    expect(a).toEqual(b);
  });
});

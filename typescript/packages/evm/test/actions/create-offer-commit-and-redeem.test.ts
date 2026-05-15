import { describe, expect, it } from "vitest";
import type { FullOfferArgs } from "@bosonprotocol/common";
import { orchestration } from "@bosonprotocol/core-sdk";

import { buildCreateOfferCommitAndRedeemCalldata } from "../../src/actions/create-offer-commit-and-redeem.js";

// Pinned literal core-sdk uses internally for
// `signMetaTxCreateOfferCommitAndRedeem`. If this assertion fails, the
// EIP-712 meta-tx hash will recover to the wrong address on-chain —
// investigate before "fixing" the test.
const EXPECTED_FUNCTION_NAME =
  "createOfferCommitAndRedeem(((uint256,uint256,uint256,uint256,uint256,uint256,address,uint8,uint8,string,string,bool,uint256,(address[],uint256[])[],uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256),(uint256,address),(uint8,uint8,address,uint8,uint256,uint256,uint256,uint256),uint256,uint256,bool),address,bytes,uint256)";

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

describe("buildCreateOfferCommitAndRedeemCalldata", () => {
  it("returns the pinned functionName literal core-sdk hashes against", async () => {
    const out = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    expect(out.functionName).toBe(EXPECTED_FUNCTION_NAME);
  });

  it("functionSignature byte-matches core-sdk's orchestration.iface.encodeCreateOfferCommitAndRedeem", async () => {
    const out = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    expect(out.functionSignature).toBe(
      orchestration.iface.encodeCreateOfferCommitAndRedeem(baseOffer),
    );
  });

  it("functionName differs from Flow A's createOfferAndCommit selector (arity guard)", async () => {
    const out = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    // Flow A signature ends in `...(uint256,(address[],uint256[]),address))`;
    // Flow B drops the trailing tuple and the agent-info args.
    expect(out.functionName).not.toContain("(uint256,(address[],uint256[]),address))");
    expect(out.functionName.endsWith(",address,bytes,uint256)")).toBe(true);
  });

  it("emits a 0x-prefixed lowercase hex string", async () => {
    const out = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    expect(out.functionSignature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("is deterministic for fixed inputs", async () => {
    const a = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    const b = await buildCreateOfferCommitAndRedeemCalldata({ fullOffer: baseOffer });
    expect(a).toEqual(b);
  });
});

import { abis } from "@bosonprotocol/common";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { buildBpip12Calldata, buildBpip12Queue } from "../../src/internal/build-bpip12-calldata.js";
import { preBuyerSkipSlots } from "../../src/internal/queue-layout.js";

const META_TX_HANDLER_ABI = abis.IBosonMetaTransactionsHandlerABI as readonly unknown[];

const SAMPLE_ERC3009 = {
  kind: "erc3009" as const,
  data: {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: "1000000",
    validAfter: 0,
    validBefore: 0x6a36b768,
    nonce: `0x${"77".repeat(32)}`,
    r: `0x${"aa".repeat(32)}`,
    s: `0x${"bb".repeat(32)}`,
    v: 27,
  },
};

describe("preBuyerSkipSlots", () => {
  it("returns 1 for createOfferAndCommit (zero-amount seller-deposit slot precedes the buyer pull)", () => {
    expect(preBuyerSkipSlots("boson-createOfferAndCommit")).toBe(1);
  });

  it("returns 1 for createOfferCommitAndRedeem (same pre-buyer layout as deferred commit)", () => {
    expect(preBuyerSkipSlots("boson-createOfferCommitAndRedeem")).toBe(1);
  });

  it("returns 0 for actions without a pre-buyer transferFundsIn site", () => {
    expect(preBuyerSkipSlots("boson-redeem")).toBe(0);
    expect(preBuyerSkipSlots("boson-completeExchange")).toBe(0);
    expect(preBuyerSkipSlots("boson-raiseDispute")).toBe(0);
  });

  it("returns 0 for unknown action ids (forward-compatible default)", () => {
    expect(preBuyerSkipSlots("boson-future-commit")).toBe(0);
  });
});

describe("buildBpip12Queue", () => {
  it("prepends one empty entry for createOfferAndCommit and packs the auth at index 1", () => {
    const queue = buildBpip12Queue({
      actionId: "boson-createOfferAndCommit",
      tokenAuth: SAMPLE_ERC3009,
    });
    expect(queue.length).toBe(2);
    // Slot 0: empty bytes — the protocol's `discardNext()` advances past
    // this on the zero-amount seller-deposit `transferFundsIn`.
    expect(queue[0]).toBe("0x");
    // Slot 1: non-empty strategy-typed entry — the buyer's ERC-3009
    // auth, consumed by the price `transferFundsIn`.
    expect(queue[1].startsWith("0x")).toBe(true);
    expect(queue[1].length).toBeGreaterThan(2);
  });

  it("places the auth at index 0 for actions with no pre-buyer skip slots", () => {
    const queue = buildBpip12Queue({
      actionId: "boson-redeem",
      tokenAuth: SAMPLE_ERC3009,
    });
    expect(queue.length).toBe(1);
    expect(queue[0].startsWith("0x")).toBe(true);
    expect(queue[0].length).toBeGreaterThan(2);
  });
});

describe("buildBpip12Calldata", () => {
  it("targets the Boson Diamond and encodes the BPIP-12 envelope with the right queue layout", () => {
    const escrow = `0x${"33".repeat(20)}` as const;
    const buyer = `0x${"44".repeat(20)}` as const;
    const functionName = "createOfferAndCommit(...)";
    const functionSignature = `0x${"ab".repeat(50)}` as const;
    const signature = `0x${"aa".repeat(32)}${"bb".repeat(32)}1b` as const;
    const calldata = buildBpip12Calldata({
      escrowAddress: escrow,
      userAddress: buyer,
      functionName,
      functionSignature,
      nonce: 1n,
      signature,
      actionId: "boson-createOfferAndCommit",
      tokenAuth: SAMPLE_ERC3009,
    });
    expect(calldata.to).toBe(escrow);

    const decoded = decodeFunctionData({
      abi: META_TX_HANDLER_ABI,
      data: calldata.data,
    });
    expect(decoded.functionName).toBe("executeMetaTransactionWithTokenTransferAuthorization");
    const [decodedUser, decodedFnName, decodedFnSig, decodedNonce, decodedSig, queue] =
      decoded.args as readonly [
        `0x${string}`,
        string,
        `0x${string}`,
        bigint,
        `0x${string}`,
        readonly `0x${string}`[],
      ];
    expect(decodedUser).toBe(buyer);
    expect(decodedFnName).toBe(functionName);
    expect(decodedFnSig).toBe(functionSignature);
    expect(decodedNonce).toBe(1n);
    expect(decodedSig).toBe(signature);

    expect(queue.length).toBe(2);
    expect(queue[0]).toBe("0x");
  });
});

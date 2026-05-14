// Unit tests for `client.signAction` covering each post-commit action.
//
// Verifies the dispatcher routes to the matching `CoreSDK.signMetaTx*`
// method (asserted via the `functionName` core-sdk embeds in the result)
// and shapes the result into a wire-format `BosonMetaTx` with the buyer's
// address, a numeric-string nonce, and a 65-byte signature split into
// `{ v, r, s }`. Also verifies the paired `signedPayload` Hex round-trips
// back to the same meta-tx through the shared `@bosonprotocol/x402-evm`
// codec — that's the wire-format contract with the server / facilitator.
// The protocol meta-tx domain is salt-based; verifying recoverability
// here would mean reconstructing core-sdk's domain by hand, so we instead
// lean on the round-trip test in `handle402.test.ts` (which already
// exercises the same signing path through createOfferAndCommit).

import { decodeSignedPayload } from "@bosonprotocol/x402-evm/codec";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { createX402bClient } from "../src/client.js";
import type { Signer } from "../src/types.js";

const TEST_KEY = `0x${"42".repeat(32)}` as const;
const BUYER_ACCOUNT = privateKeyToAccount(TEST_KEY);

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const NETWORK = "eip155:8453";
const EXCHANGE_ID = "42";

const BUYER_SIGNER: Signer = {
  getAddress: async () => BUYER_ACCOUNT.address,
  signTypedData: (args) =>
    BUYER_ACCOUNT.signTypedData(args as Parameters<typeof BUYER_ACCOUNT.signTypedData>[0]),
};

function makeClient() {
  return createX402bClient({
    signer: BUYER_SIGNER,
  });
}

const SIMPLE_CASES: Array<{
  actionId: Parameters<ReturnType<typeof makeClient>["signAction"]>[0]["actionId"];
  functionName: string;
}> = [
  { actionId: "boson-redeem", functionName: "redeemVoucher(uint256)" },
  { actionId: "boson-cancelVoucher", functionName: "cancelVoucher(uint256)" },
  { actionId: "boson-completeExchange", functionName: "completeExchange(uint256)" },
  { actionId: "boson-raiseDispute", functionName: "raiseDispute(uint256)" },
  { actionId: "boson-retractDispute", functionName: "retractDispute(uint256)" },
  { actionId: "boson-escalateDispute", functionName: "escalateDispute(uint256)" },
];

describe("signAction — simple post-commit actions", () => {
  it.each(SIMPLE_CASES)(
    "%s signs a meta-tx with functionName=$functionName and the buyer's address",
    async ({ actionId, functionName }) => {
      const client = makeClient();
      const { metaTx, signedPayload } = await client.signAction({
        actionId: actionId as Exclude<typeof actionId, "boson-resolveDispute">,
        exchangeId: EXCHANGE_ID,
        network: NETWORK,
        escrowAddress: ESCROW,
      });

      expect(metaTx.from.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
      expect(metaTx.nonce).toMatch(/^\d+$/);
      expect(metaTx.functionName).toBe(functionName);
      expect(metaTx.functionSignature.startsWith("0x")).toBe(true);
      expect(metaTx.functionSignature.length).toBeGreaterThan(2);
      expect(metaTx.sig.r.startsWith("0x")).toBe(true);
      expect(metaTx.sig.r).toHaveLength(66);
      expect(metaTx.sig.s.startsWith("0x")).toBe(true);
      expect(metaTx.sig.s).toHaveLength(66);
      expect(typeof metaTx.sig.v).toBe("number");

      // `signedPayload` must round-trip back to the same meta-tx through
      // the shared codec — that's the wire-format contract with the
      // server / facilitator. Address comparison is case-insensitive
      // because viem re-checksums addresses when decoding ABI tuples.
      const decoded = decodeSignedPayload(signedPayload);
      expect(decoded.from.toLowerCase()).toBe(metaTx.from.toLowerCase());
      expect(decoded.nonce).toBe(metaTx.nonce);
      expect(decoded.functionName).toBe(metaTx.functionName);
      expect(decoded.functionSignature).toBe(metaTx.functionSignature);
      expect(decoded.sig).toEqual(metaTx.sig);
    },
  );

  it("produces different nonces across consecutive calls (collision protection)", async () => {
    const client = makeClient();
    const a = await client.signAction({
      actionId: "boson-redeem",
      exchangeId: EXCHANGE_ID,
      network: NETWORK,
      escrowAddress: ESCROW,
    });
    const b = await client.signAction({
      actionId: "boson-redeem",
      exchangeId: EXCHANGE_ID,
      network: NETWORK,
      escrowAddress: ESCROW,
    });
    expect(a.metaTx.nonce).not.toBe(b.metaTx.nonce);
  });
});

describe("signAction — boson-resolveDispute", () => {
  it("threads buyerPercent and counterpartySig through to the meta-tx", async () => {
    const client = makeClient();
    const counterpartySig = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as `0x${string}`; // dummy 65-byte hex

    const { metaTx } = await client.signAction({
      actionId: "boson-resolveDispute",
      exchangeId: EXCHANGE_ID,
      network: NETWORK,
      escrowAddress: ESCROW,
      buyerPercent: "5000",
      counterpartySig,
    });

    expect(metaTx.functionName).toBe("resolveDispute(uint256,uint256,bytes)");
    expect(metaTx.from.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
    expect(metaTx.functionSignature.startsWith("0x")).toBe(true);
  });

  it("accepts an object-form counterpartySig", async () => {
    const client = makeClient();
    const r = `0x${"aa".repeat(32)}` as const;
    const s = `0x${"bb".repeat(32)}` as const;

    const { metaTx } = await client.signAction({
      actionId: "boson-resolveDispute",
      exchangeId: EXCHANGE_ID,
      network: NETWORK,
      escrowAddress: ESCROW,
      buyerPercent: 5000,
      counterpartySig: { r, s, v: 27 },
    });

    expect(metaTx.functionName).toBe("resolveDispute(uint256,uint256,bytes)");
  });
});

// Cross-validate the hand-mirrored EIP-712 type-lists against the parallel
// internal type-lists that `@bosonprotocol/core-sdk`'s
// `signReceiveWith{Erc3009Authorization,Erc2612Permit,Permit2}` helpers emit.
//
// The SDK's helpers auto-generate (ERC-3009, Permit2) or auto-fetch (Permit)
// the nonce before returning typed-data, which is why we can't use them
// directly on the verification path — but in `returnTypedDataToSign: true`
// mode they hand back a viem-compatible StructuredData whose `types`
// portion is the SDK's authoritative ground-truth definition. If our
// hand-mirror's field-order or types ever drifts from the SDK's, this
// test fails — catching the kind of silent signature-recovery breakage
// that would otherwise only surface on-chain.
//
// We stub the `Web3LibAdapter` minimally:
//   - ERC-3009 and Permit2 never invoke web3Lib in `returnTypedDataToSign`
//     mode, so a throwing stub suffices.
//   - Permit calls `web3Lib.call(nonces(user))` to fetch the token nonce
//     *before* checking `returnTypedDataToSign`, so we answer that one
//     call with a dummy uint256-zero and let everything else throw.
//
// `pad` and `dummyAddress` are local helpers — the test does not exercise
// the values, only the resulting type-list structure.

import type { Web3LibAdapter } from "@bosonprotocol/common";
import { erc20 } from "@bosonprotocol/core-sdk";
import { describe, expect, it } from "vitest";

import {
  ERC3009_TYPES,
  PERMIT_TYPES,
  PERMIT2_TYPES,
} from "../../../src/eip712/token-auth/index.js";

const DUMMY_USER = "0x" + "11".repeat(20);
const DUMMY_TOKEN = "0x" + "22".repeat(20);
const DUMMY_SPENDER = "0x" + "33".repeat(20);
const DUMMY_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** ABI-encoded uint256(0) — sufficient to make `nonces(user)` decode to 0. */
const UINT256_ZERO = "0x" + "00".repeat(32);

function throwingWeb3Lib(callerTag: string): Web3LibAdapter {
  const unreachable = (m: string) =>
    new Error(`sdk-parity test stub: ${callerTag}: web3Lib.${m}() should never be called`);
  return {
    uuid: `${callerTag}:stub`,
    getSignerAddress: () => Promise.reject(unreachable("getSignerAddress")),
    isSignerContract: () => Promise.reject(unreachable("isSignerContract")),
    getChainId: () => Promise.reject(unreachable("getChainId")),
    getBalance: () => Promise.reject(unreachable("getBalance")),
    estimateGas: () => Promise.reject(unreachable("estimateGas")),
    sendTransaction: () => Promise.reject(unreachable("sendTransaction")),
    call: () => Promise.reject(unreachable("call")),
    send: () => Promise.reject(unreachable("send")),
    getTransactionReceipt: () => Promise.reject(unreachable("getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable("getCurrentTimeMs")),
  };
}

/** Variant of the throwing stub that answers a single `call` (used by Permit's nonces lookup). */
function noncesCallStub(): Web3LibAdapter {
  const base = throwingWeb3Lib("permit-parity");
  return { ...base, call: async () => UINT256_ZERO };
}

describe("token-auth sdk-parity", () => {
  it("ERC-3009 hand-mirror type-list matches @bosonprotocol/core-sdk's signReceiveWithErc3009Authorization", async () => {
    const sd = await erc20.handler.signReceiveWithErc3009Authorization({
      web3Lib: throwingWeb3Lib("erc3009-parity"),
      chainId: 8453,
      user: DUMMY_USER,
      exchangeToken: DUMMY_TOKEN,
      spender: DUMMY_SPENDER,
      value: "1000000",
      tokenDomain: { name: "USD Coin", version: "2" },
      validAfter: 0,
      validBefore: 1_900_000_000,
      returnTypedDataToSign: true,
    });
    expect(sd.primaryType).toBe("ReceiveWithAuthorization");
    expect(sd.types.ReceiveWithAuthorization).toEqual(ERC3009_TYPES.ReceiveWithAuthorization);
  });

  it("EIP-2612 Permit hand-mirror type-list matches @bosonprotocol/core-sdk's signReceiveWithErc2612Permit", async () => {
    const sd = await erc20.handler.signReceiveWithErc2612Permit({
      web3Lib: noncesCallStub(),
      chainId: 8453,
      user: DUMMY_USER,
      exchangeToken: DUMMY_TOKEN,
      spender: DUMMY_SPENDER,
      value: "1000000",
      tokenDomain: { name: "USD Coin", version: "2" },
      deadline: 1_900_000_000,
      returnTypedDataToSign: true,
    });
    expect(sd.primaryType).toBe("Permit");
    expect(sd.types.Permit).toEqual(PERMIT_TYPES.Permit);
  });

  it("Permit2 hand-mirror type-list matches @bosonprotocol/core-sdk's signReceiveWithPermit2", async () => {
    const sd = await erc20.handler.signReceiveWithPermit2({
      web3Lib: throwingWeb3Lib("permit2-parity"),
      chainId: 8453,
      user: DUMMY_USER,
      exchangeToken: DUMMY_TOKEN,
      spender: DUMMY_SPENDER,
      value: "1000000",
      permit2Address: DUMMY_PERMIT2,
      deadline: 1_900_000_000,
      permit2Nonce: 0,
      returnTypedDataToSign: true,
    });
    expect(sd.primaryType).toBe("PermitTransferFrom");
    expect(sd.types.PermitTransferFrom).toEqual(PERMIT2_TYPES.PermitTransferFrom);
    expect(sd.types.TokenPermissions).toEqual(PERMIT2_TYPES.TokenPermissions);
  });
});

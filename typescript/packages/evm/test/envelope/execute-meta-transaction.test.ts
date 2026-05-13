import { describe, expect, it } from "vitest";
import { metaTx } from "@bosonprotocol/core-sdk";

import { buildExecuteMetaTransactionTx } from "../../src/envelope/execute-meta-transaction.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const BUYER = "0x2222222222222222222222222222222222222222" as const;
const FUNCTION_NAME = "createOfferAndCommit(...)";
const FUNCTION_SIGNATURE = "0xdeadbeef" as const;
const SIG_R = `0x${"aa".repeat(32)}` as const;
const SIG_S = `0x${"bb".repeat(32)}` as const;

describe("buildExecuteMetaTransactionTx", () => {
  const args = {
    escrowAddress: ESCROW,
    userAddress: BUYER,
    functionName: FUNCTION_NAME,
    functionSignature: FUNCTION_SIGNATURE,
    nonce: 7n,
    sig: { r: SIG_R, s: SIG_S, v: 27 },
  } as const;

  it("targets the escrow address", () => {
    const tx = buildExecuteMetaTransactionTx(args);
    expect(tx.to).toBe(ESCROW);
  });

  it("encodes via core-sdk's metaTransactionsHandlerIface with packed r+s+v signature", () => {
    const tx = buildExecuteMetaTransactionTx(args);
    const expectedPackedSig = `0x${"aa".repeat(32)}${"bb".repeat(32)}1b`;
    const expectedData = metaTx.iface.metaTransactionsHandlerIface.encodeFunctionData(
      "executeMetaTransaction",
      [BUYER, FUNCTION_NAME, FUNCTION_SIGNATURE, "7", expectedPackedSig],
    );
    expect(tx.data).toBe(expectedData);
  });

  it("decodes back to the input args via the same Interface", () => {
    const tx = buildExecuteMetaTransactionTx(args);
    const [userAddress, functionName, functionSignature, nonce, signature] =
      metaTx.iface.metaTransactionsHandlerIface.decodeFunctionData(
        "executeMetaTransaction",
        tx.data,
      );
    expect(userAddress.toLowerCase()).toBe(BUYER);
    expect(functionName).toBe(FUNCTION_NAME);
    expect(functionSignature).toBe(FUNCTION_SIGNATURE);
    expect(nonce.toString()).toBe("7");
    expect((signature as string).toLowerCase()).toBe(`0x${"aa".repeat(32)}${"bb".repeat(32)}1b`);
  });

  it("accepts v=28 and packs the high byte correctly", () => {
    const tx = buildExecuteMetaTransactionTx({ ...args, sig: { r: SIG_R, s: SIG_S, v: 28 } });
    const [, , , , signature] = metaTx.iface.metaTransactionsHandlerIface.decodeFunctionData(
      "executeMetaTransaction",
      tx.data,
    );
    expect((signature as string).slice(-2)).toBe("1c");
  });

  it("rejects v values other than 27/28 to avoid the 0/1 normalization trap", () => {
    expect(() =>
      buildExecuteMetaTransactionTx({ ...args, sig: { r: SIG_R, s: SIG_S, v: 0 } }),
    ).toThrow(/v must be 27 or 28/);
    expect(() =>
      buildExecuteMetaTransactionTx({ ...args, sig: { r: SIG_R, s: SIG_S, v: 1 } }),
    ).toThrow(/v must be 27 or 28/);
  });

  it("rejects r/s that aren't exactly 32-byte hex words", () => {
    // shortened
    expect(() =>
      buildExecuteMetaTransactionTx({
        ...args,
        sig: { r: `0x${"aa".repeat(31)}`, s: SIG_S, v: 27 },
      }),
    ).toThrow(/signature r must be a 32-byte hex value/);

    // over-long
    expect(() =>
      buildExecuteMetaTransactionTx({
        ...args,
        sig: { r: SIG_R, s: `0x${"bb".repeat(33)}`, v: 27 },
      }),
    ).toThrow(/signature s must be a 32-byte hex value/);

    // missing 0x prefix
    expect(() =>
      buildExecuteMetaTransactionTx({
        ...args,
        sig: { r: "aa".repeat(32) as `0x${string}`, s: SIG_S, v: 27 },
      }),
    ).toThrow(/signature r must be a 32-byte hex value/);

    // non-hex character
    expect(() =>
      buildExecuteMetaTransactionTx({
        ...args,
        sig: { r: SIG_R, s: `0x${"zz".repeat(32)}`, v: 27 },
      }),
    ).toThrow(/signature s must be a 32-byte hex value/);
  });
});

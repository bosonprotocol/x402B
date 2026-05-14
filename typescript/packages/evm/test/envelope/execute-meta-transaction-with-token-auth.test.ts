import { describe, expect, it } from "vitest";
import { erc20, metaTx } from "@bosonprotocol/core-sdk";

import {
  buildExecuteMetaTransactionWithTokenAuthTx,
  type TransferAuthorization,
} from "../../src/envelope/execute-meta-transaction-with-token-auth.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const BUYER = "0x2222222222222222222222222222222222222222" as const;
const FUNCTION_NAME = "createOfferAndCommit(...)";
const FUNCTION_SIGNATURE = "0xdeadbeef" as const;
const SIG_R = `0x${"aa".repeat(32)}` as const;
const SIG_S = `0x${"bb".repeat(32)}` as const;

function packedSig(v: 27 | 28 = 27): `0x${string}` {
  return `0x${"aa".repeat(32)}${"bb".repeat(32)}${v === 27 ? "1b" : "1c"}`;
}

function sampleErc3009Auth(): TransferAuthorization {
  return {
    strategy: "ERC3009",
    data: {
      validAfter: 0,
      validBefore: 1_900_000_000,
      nonce: `0x${"cc".repeat(32)}`,
    },
    r: `0x${"dd".repeat(32)}`,
    s: `0x${"ee".repeat(32)}`,
    v: 27,
    signature: `0x${"dd".repeat(32)}${"ee".repeat(32)}1b`,
  };
}

describe("buildExecuteMetaTransactionWithTokenAuthTx", () => {
  const args = {
    escrowAddress: ESCROW,
    userAddress: BUYER,
    functionName: FUNCTION_NAME,
    functionSignature: FUNCTION_SIGNATURE,
    nonce: 7n,
    sig: { r: SIG_R, s: SIG_S, v: 27 as const },
    transferAuthorizations: [sampleErc3009Auth()],
  };

  it("targets the escrow address", () => {
    const tx = buildExecuteMetaTransactionWithTokenAuthTx(args);
    expect(tx.to).toBe(ESCROW);
  });

  it("encodes via metaTransactionsHandlerIface with packed sig and SDK-encoded queue", () => {
    const tx = buildExecuteMetaTransactionWithTokenAuthTx(args);
    const expectedQueue = erc20.handler.encodeTransferAuthorizationQueue([sampleErc3009Auth()]);
    const expectedData = metaTx.iface.metaTransactionsHandlerIface.encodeFunctionData(
      "executeMetaTransactionWithTokenTransferAuthorization",
      [BUYER, FUNCTION_NAME, FUNCTION_SIGNATURE, "7", packedSig(27), expectedQueue],
    );
    expect(tx.data).toBe(expectedData);
  });

  it("round-trips back through the same Interface", () => {
    const tx = buildExecuteMetaTransactionWithTokenAuthTx(args);
    const [userAddress, functionName, functionSignature, nonce, signature, queue] =
      metaTx.iface.metaTransactionsHandlerIface.decodeFunctionData(
        "executeMetaTransactionWithTokenTransferAuthorization",
        tx.data,
      );
    expect(userAddress.toLowerCase()).toBe(BUYER);
    expect(functionName).toBe(FUNCTION_NAME);
    expect(functionSignature).toBe(FUNCTION_SIGNATURE);
    expect(nonce.toString()).toBe("7");
    expect((signature as string).toLowerCase()).toBe(packedSig(27));
    // The decoded queue is the same bytes the SDK encoder produced.
    expect((queue as string).toLowerCase()).toBe(
      erc20.handler.encodeTransferAuthorizationQueue([sampleErc3009Auth()]).toLowerCase(),
    );
  });

  it("function selector differs from executeMetaTransaction (BPIP-12 entry point)", () => {
    const tx = buildExecuteMetaTransactionWithTokenAuthTx(args);
    const selector = tx.data.slice(0, 10);
    const noAuthSelector = metaTx.iface.metaTransactionsHandlerIface
      .encodeFunctionData("executeMetaTransaction", [
        BUYER,
        FUNCTION_NAME,
        FUNCTION_SIGNATURE,
        "7",
        packedSig(27),
      ])
      .slice(0, 10);
    expect(selector).not.toBe(noAuthSelector);
  });

  it("rejects v values other than 27/28", () => {
    expect(() =>
      buildExecuteMetaTransactionWithTokenAuthTx({
        ...args,
        sig: { r: SIG_R, s: SIG_S, v: 0 },
      }),
    ).toThrow(/v must be 27 or 28/);
  });
});

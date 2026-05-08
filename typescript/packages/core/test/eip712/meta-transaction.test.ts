import { describe, expect, it } from "vitest";
import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  hashMetaTransaction,
  META_TRANSACTION_PRIMARY_TYPE,
  metaTransactionTypedData,
  recoverMetaTransactionSigner,
  type MetaTransactionMessage,
} from "../../src/eip712/index.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;

// Deterministic test key — never use anywhere else.
const TEST_PRIVATE_KEY = `0x${"11".repeat(32)}` as const;

const baseMessage: MetaTransactionMessage = {
  nonce: 0n,
  from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
  contractAddress: ESCROW,
  functionName: "createOfferCommitAndRedeem(BosonTypes.FullOffer,address,bytes,uint256)",
  functionSignature: "0xabcdef",
};

const baseDomainArgs = { chainId: 8453, verifyingContract: ESCROW } as const;

describe("metaTransactionTypedData (delegates to core-sdk's signMetaTx)", () => {
  it("returns the salt-based Boson domain (no chainId field)", async () => {
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    expect(td.primaryType).toBe(META_TRANSACTION_PRIMARY_TYPE);
    expect(td.domain).toMatchObject({
      name: "Boson Protocol",
      version: "V2",
      verifyingContract: ESCROW,
      salt: numberToHex(8453, { size: 32 }),
    });
    expect(td.domain).not.toHaveProperty("chainId");
  });

  it("declares MetaTransaction with the protocol's five fields in production order", async () => {
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    const fields = td.types.MetaTransaction;
    expect(fields.map((f) => f.name)).toEqual([
      "nonce",
      "from",
      "contractAddress",
      "functionName",
      "functionSignature",
    ]);
    expect(fields.map((f) => f.type)).toEqual(["uint256", "address", "address", "string", "bytes"]);
  });

  it("includes the salt-flavor EIP712Domain so viem doesn't auto-derive the standard one", async () => {
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    expect(td.types.EIP712Domain.map((f) => f.name)).toEqual([
      "name",
      "version",
      "verifyingContract",
      "salt",
    ]);
  });

  it("threads message fields through to the captured typed-data", async () => {
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    expect(td.message).toMatchObject({
      nonce: "0",
      from: baseMessage.from,
      contractAddress: ESCROW,
      functionName: baseMessage.functionName,
      functionSignature: baseMessage.functionSignature,
    });
  });
});

describe("hashMetaTransaction", () => {
  it("is deterministic for fixed inputs", async () => {
    const h1 = await hashMetaTransaction({ ...baseDomainArgs, message: baseMessage });
    const h2 = await hashMetaTransaction({ ...baseDomainArgs, message: baseMessage });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs across chains for the same message (salt diverges)", async () => {
    const onBase = await hashMetaTransaction({ ...baseDomainArgs, message: baseMessage });
    const onPolygon = await hashMetaTransaction({
      chainId: 137,
      verifyingContract: ESCROW,
      message: baseMessage,
    });
    expect(onBase).not.toBe(onPolygon);
  });

  it("differs when any message field changes", async () => {
    const original = await hashMetaTransaction({ ...baseDomainArgs, message: baseMessage });
    const bumpedNonce = await hashMetaTransaction({
      ...baseDomainArgs,
      message: { ...baseMessage, nonce: 1n },
    });
    const renamedFn = await hashMetaTransaction({
      ...baseDomainArgs,
      message: { ...baseMessage, functionName: "createOfferAndCommit(...)" },
    });
    const swappedSig = await hashMetaTransaction({
      ...baseDomainArgs,
      message: { ...baseMessage, functionSignature: "0x123456" },
    });
    expect(bumpedNonce).not.toBe(original);
    expect(renamedFn).not.toBe(original);
    expect(swappedSig).not.toBe(original);
  });
});

describe("signMetaTransaction round-trip via viem account", () => {
  it("the recovered signer matches `from`", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    const signature = await account.signTypedData(
      td as unknown as Parameters<typeof account.signTypedData>[0],
    );
    const recovered = await recoverMetaTransactionSigner({
      ...baseDomainArgs,
      message: baseMessage,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
    expect(recovered.toLowerCase()).toBe(baseMessage.from.toLowerCase());
  });

  it("a signature for one message does not recover for a different message", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const td = await metaTransactionTypedData({ ...baseDomainArgs, message: baseMessage });
    const signature = await account.signTypedData(
      td as unknown as Parameters<typeof account.signTypedData>[0],
    );
    const recovered = await recoverMetaTransactionSigner({
      ...baseDomainArgs,
      message: { ...baseMessage, nonce: 999n },
      signature,
    });
    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});

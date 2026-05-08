import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  hashPermit2,
  PERMIT2_ADDRESS,
  PERMIT2_DOMAIN_NAME,
  PERMIT2_PRIMARY_TYPE,
  PERMIT2_TYPES,
  permit2Domain,
  permit2TypedData,
  recoverPermit2Signer,
} from "../../../src/eip712/token-auth/index.js";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_KEY = `0x${"55".repeat(32)}` as const;

const message = {
  permitted: { token: TOKEN, amount: 1_000_000n },
  spender: ESCROW,
  nonce: 0n,
  deadline: 1_900_000_000n,
};

describe("permit2 typed-data", () => {
  it("uses the canonical Permit2 contract address as verifyingContract", () => {
    const d = permit2Domain(8453);
    expect(d.name).toBe(PERMIT2_DOMAIN_NAME);
    expect(d.name).toBe("Permit2");
    expect(d.verifyingContract).toBe(PERMIT2_ADDRESS);
    expect(d.chainId).toBe(8453);
    expect(d).not.toHaveProperty("version");
  });

  it("uses the no-witness PermitTransferFrom shape (4 fields, spender at top level)", () => {
    expect(PERMIT2_PRIMARY_TYPE).toBe("PermitTransferFrom");
    expect(PERMIT2_TYPES.PermitTransferFrom.map((f) => f.name)).toEqual([
      "permitted",
      "spender",
      "nonce",
      "deadline",
    ]);
    expect(PERMIT2_TYPES.PermitTransferFrom.map((f) => f.type)).toEqual([
      "TokenPermissions",
      "address",
      "uint256",
      "uint256",
    ]);
  });

  it("reuses TokenPermissions from @x402/evm permit2WitnessTypes", () => {
    expect(PERMIT2_TYPES.TokenPermissions.map((f) => f.name)).toEqual(["token", "amount"]);
    expect(PERMIT2_TYPES.TokenPermissions.map((f) => f.type)).toEqual(["address", "uint256"]);
  });

  it("hash differs across chains (Permit2 domain is chain-scoped)", () => {
    const onBase = hashPermit2({ chainId: 8453, message });
    const onPolygon = hashPermit2({ chainId: 137, message });
    expect(onBase).not.toBe(onPolygon);
  });

  it("hash differs when permitted.amount or spender changes", () => {
    const original = hashPermit2({ chainId: 8453, message });
    const bumpedAmount = hashPermit2({
      chainId: 8453,
      message: { ...message, permitted: { ...message.permitted, amount: 2_000_000n } },
    });
    const otherSpender = hashPermit2({
      chainId: 8453,
      message: { ...message, spender: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
    });
    expect(bumpedAmount).not.toBe(original);
    expect(otherSpender).not.toBe(original);
  });

  it("round-trip: viem account signs, recoverPermit2Signer recovers same address", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const td = permit2TypedData({ chainId: 8453, message });
    const signature = await account.signTypedData(td);
    const recovered = await recoverPermit2Signer({ chainId: 8453, message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

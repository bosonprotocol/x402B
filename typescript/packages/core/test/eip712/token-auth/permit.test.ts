import { describe, expect, it } from "vitest";
import type { TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  hashPermit,
  PERMIT_PRIMARY_TYPE,
  PERMIT_TYPES,
  permitTypedData,
  recoverPermitSigner,
} from "../../../src/eip712/token-auth/index.js";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_KEY = `0x${"44".repeat(32)}` as const;

const domain: TypedDataDomain = {
  name: "USD Coin",
  version: "2",
  chainId: 8453,
  verifyingContract: TOKEN,
};

const message = {
  owner: privateKeyToAccount(TEST_KEY).address,
  spender: ESCROW,
  value: 1_000_000n,
  nonce: 0n,
  deadline: 1_900_000_000n,
};

describe("EIP-2612 permit typed-data", () => {
  it("declares the canonical Permit struct (5 fields, owner/spender/value/nonce/deadline)", () => {
    expect(PERMIT_TYPES.Permit.map((f) => f.name)).toEqual([
      "owner",
      "spender",
      "value",
      "nonce",
      "deadline",
    ]);
    expect(PERMIT_TYPES.Permit.map((f) => f.type)).toEqual([
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
    ]);
    expect(PERMIT_PRIMARY_TYPE).toBe("Permit");
  });

  it("hash is deterministic and 32 bytes", () => {
    const h1 = hashPermit({ domain, message });
    const h2 = hashPermit({ domain, message });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hash differs when nonce or deadline changes", () => {
    const original = hashPermit({ domain, message });
    const bumpedNonce = hashPermit({ domain, message: { ...message, nonce: 1n } });
    const bumpedDeadline = hashPermit({
      domain,
      message: { ...message, deadline: message.deadline + 1n },
    });
    expect(bumpedNonce).not.toBe(original);
    expect(bumpedDeadline).not.toBe(original);
  });

  it("round-trip: viem account signs, recoverPermitSigner recovers same address", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const td = permitTypedData({ domain, message });
    const signature = await account.signTypedData(td);
    const recovered = await recoverPermitSigner({ domain, message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

import { describe, expect, it } from "vitest";
import { keccak256, toHex, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  erc3009TypedData,
  ERC3009_PRIMARY_TYPE,
  ERC3009_TYPES,
  hashErc3009Authorization,
  recoverErc3009Signer,
} from "../../../src/eip712/token-auth/index.js";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const; // USDC on Base
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const TEST_KEY = `0x${"33".repeat(32)}` as const;

const domain: TypedDataDomain = {
  name: "USD Coin",
  version: "2",
  chainId: 8453,
  verifyingContract: TOKEN,
};

const message = {
  from: privateKeyToAccount(TEST_KEY).address,
  to: ESCROW,
  value: 1_000_000n,
  validAfter: 0n,
  validBefore: 1_900_000_000n,
  nonce: keccak256(toHex("nonce-1")),
};

describe("erc3009 typed-data", () => {
  it("uses the Boson 'ReceiveWithAuthorization' primary type, not 'TransferWithAuthorization'", () => {
    const td = erc3009TypedData({ domain, message });
    expect(td.primaryType).toBe(ERC3009_PRIMARY_TYPE);
    expect(td.primaryType).toBe("ReceiveWithAuthorization");
  });

  it("reuses the field list from @x402/evm authorizationTypes", () => {
    const fields = ERC3009_TYPES.ReceiveWithAuthorization;
    expect(fields.map((f) => f.name)).toEqual([
      "from",
      "to",
      "value",
      "validAfter",
      "validBefore",
      "nonce",
    ]);
    expect(fields.map((f) => f.type)).toEqual([
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
      "bytes32",
    ]);
  });

  it("hash is deterministic and 32 bytes", () => {
    const h1 = hashErc3009Authorization({ domain, message });
    const h2 = hashErc3009Authorization({ domain, message });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hash differs across token domains", () => {
    const onUsdc = hashErc3009Authorization({ domain, message });
    const otherToken = hashErc3009Authorization({
      domain: { ...domain, verifyingContract: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
      message,
    });
    expect(onUsdc).not.toBe(otherToken);
  });

  it("round-trip: viem account signs, recoverErc3009Signer recovers same address", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const td = erc3009TypedData({ domain, message });
    const signature = await account.signTypedData(td);
    const recovered = await recoverErc3009Signer({ domain, message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

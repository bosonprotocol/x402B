import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signerFromEthersAdapter, type Web3LibAdapterLike } from "../src/signer-from-adapter.js";

const TEST_KEY = `0x${"42".repeat(32)}` as const;
const account = privateKeyToAccount(TEST_KEY);

const fullDomain: TypedDataDomain = {
  name: "Test",
  version: "1",
  chainId: 8453,
  verifyingContract: "0xdddddddddddddddddddddddddddddddddddddddd",
};

const types = {
  Mail: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "contents", type: "string" },
  ],
} as const;

const message = {
  from: account.address,
  to: "0x1111111111111111111111111111111111111111",
  contents: "hello",
} as const;

const EXPECTED_FULL_EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const HEX_SIGNATURE_ERROR = /hex signature string/;

/**
 * Build a mock `Web3LibAdapterLike` that records every `send(...)` call and
 * signs typed-data internally with the wrapped viem account — mirroring
 * what `EthersAdapter.send("eth_signTypedData_v4", [from, json])` does end
 * to end.
 */
function buildMockAdapter(): {
  adapter: Web3LibAdapterLike;
  calls: { method: string; params: readonly unknown[] }[];
} {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const adapter: Web3LibAdapterLike = {
    getSignerAddress: async () => account.address,
    send: async (method, params) => {
      calls.push({ method, params });
      if (method !== "eth_signTypedData_v4") {
        throw new Error(`unexpected method: ${method}`);
      }
      const [, raw] = params as [string, string];
      const { domain, types: parsedTypes, primaryType, message: msg } = JSON.parse(raw);
      return account.signTypedData({
        domain,
        types: parsedTypes as Parameters<typeof account.signTypedData>[0]["types"],
        primaryType,
        message: msg,
      });
    },
  };
  return { adapter, calls };
}

describe("signerFromEthersAdapter", () => {
  it("getAddress() returns the wrapped adapter's signer address", async () => {
    const { adapter } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    expect(await signer.getAddress()).toBe(account.address);
  });

  it("signTypedData() round-trips through the adapter and recovers the signer", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    const sig = await signer.signTypedData({
      domain: fullDomain,
      types,
      primaryType: "Mail",
      message,
    });
    const recovered = await recoverTypedDataAddress({
      domain: fullDomain,
      types,
      primaryType: "Mail",
      message,
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("eth_signTypedData_v4");
    expect(calls[0]!.params[0]).toBe(account.address);
    expect(typeof calls[0]!.params[1]).toBe("string");
  });

  it("derives EIP712Domain entries from a full 4-field domain in canonical order", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    await signer.signTypedData({ domain: fullDomain, types, primaryType: "Mail", message });
    const parsed = JSON.parse(calls[0]!.params[1] as string) as {
      types: { EIP712Domain: { name: string; type: string }[] };
    };
    expect(parsed.types.EIP712Domain).toEqual(EXPECTED_FULL_EIP712_DOMAIN);
  });

  it("omits absent domain fields from the derived EIP712Domain type list", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    const partialDomain: TypedDataDomain = { name: "Test", chainId: 8453 };
    await signer.signTypedData({
      domain: partialDomain,
      types,
      primaryType: "Mail",
      message,
    });
    const parsed = JSON.parse(calls[0]!.params[1] as string) as {
      types: { EIP712Domain: { name: string; type: string }[] };
      domain: TypedDataDomain;
    };
    expect(parsed.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
    ]);
    expect(parsed.domain).toEqual(partialDomain);
  });

  it("includes a salt entry when the domain carries one", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    const saltDomain: TypedDataDomain = {
      name: "Test",
      salt: `0x${"ab".repeat(32)}`,
    };
    await signer.signTypedData({
      domain: saltDomain,
      types,
      primaryType: "Mail",
      message,
    });
    const parsed = JSON.parse(calls[0]!.params[1] as string) as {
      types: { EIP712Domain: { name: string; type: string }[] };
    };
    expect(parsed.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "salt", type: "bytes32" },
    ]);
  });

  it("serializes bigint domain and message values for JSON-RPC signing", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    const bigintDomain: TypedDataDomain = {
      name: "Test",
      version: "1",
      chainId: 8453n,
      verifyingContract: "0xdddddddddddddddddddddddddddddddddddddddd",
    };
    const paymentTypes = {
      Payment: [
        { name: "payer", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    } as const;
    const paymentMessage = {
      payer: account.address,
      amount: 123n,
    };
    const sig = await signer.signTypedData({
      domain: bigintDomain,
      types: paymentTypes,
      primaryType: "Payment",
      message: paymentMessage,
    });
    const recovered = await recoverTypedDataAddress({
      domain: bigintDomain,
      types: paymentTypes,
      primaryType: "Payment",
      message: paymentMessage,
      signature: sig,
    });
    const parsed = JSON.parse(calls[0]!.params[1] as string) as {
      domain: { chainId: string };
      message: { amount: string };
    };
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
    expect(parsed.domain.chainId).toBe("8453");
    expect(parsed.message.amount).toBe("123");
  });

  it("rejects when adapter.send returns a non-string value", async () => {
    const adapter: Web3LibAdapterLike = {
      getSignerAddress: async () => account.address,
      send: async () => 42,
    };
    const signer = signerFromEthersAdapter(adapter);
    await expect(
      signer.signTypedData({ domain: fullDomain, types, primaryType: "Mail", message }),
    ).rejects.toThrow(HEX_SIGNATURE_ERROR);
  });

  it("rejects when adapter.send returns a 0x-prefixed string with non-hex chars", async () => {
    const adapter: Web3LibAdapterLike = {
      getSignerAddress: async () => account.address,
      send: async () => "0xzz",
    };
    const signer = signerFromEthersAdapter(adapter);
    await expect(
      signer.signTypedData({ domain: fullDomain, types, primaryType: "Mail", message }),
    ).rejects.toThrow(HEX_SIGNATURE_ERROR);
  });

  it("rejects when adapter.getSignerAddress returns a malformed address", async () => {
    const adapter: Web3LibAdapterLike = {
      getSignerAddress: async () => "not-an-address",
      send: async () => `0x${"00".repeat(65)}`,
    };
    const signer = signerFromEthersAdapter(adapter);
    await expect(signer.getAddress()).rejects.toThrow();
    await expect(
      signer.signTypedData({ domain: fullDomain, types, primaryType: "Mail", message }),
    ).rejects.toThrow();
  });

  it("checksums a lowercase address returned by the adapter", async () => {
    const lowercase = account.address.toLowerCase();
    const adapter: Web3LibAdapterLike = {
      getSignerAddress: async () => lowercase,
      send: async () => `0x${"00".repeat(65)}`,
    };
    const signer = signerFromEthersAdapter(adapter);
    expect(await signer.getAddress()).toBe(account.address);
  });

  it("derived EIP712Domain wins over a caller-supplied entry of the same name", async () => {
    const { adapter, calls } = buildMockAdapter();
    const signer = signerFromEthersAdapter(adapter);
    const hostileTypes = {
      EIP712Domain: [{ name: "name", type: "string" }],
      Mail: types.Mail,
    } as const;
    await signer.signTypedData({
      domain: fullDomain,
      types: hostileTypes,
      primaryType: "Mail",
      message,
    });
    const parsed = JSON.parse(calls[0]!.params[1] as string) as {
      types: { EIP712Domain: { name: string; type: string }[] };
    };
    expect(parsed.types.EIP712Domain).toEqual(EXPECTED_FULL_EIP712_DOMAIN);
  });
});

import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signerToWeb3LibAdapter, viemAccountSigner } from "../src/signer/index.js";

const TEST_KEY = `0x${"42".repeat(32)}` as const;

const account = privateKeyToAccount(TEST_KEY);

const domain: TypedDataDomain = {
  name: "Test",
  version: "1",
  chainId: 8453,
  verifyingContract: "0xdddddddddddddddddddddddddddddddddddddddd",
};

const types = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
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

describe("viemAccountSigner", () => {
  it("getAddress returns the underlying account address", async () => {
    const signer = viemAccountSigner(account);
    expect(await signer.getAddress()).toBe(account.address);
  });

  it("signTypedData produces a signature that recovers to the account", async () => {
    const signer = viemAccountSigner(account);
    const sig = await signer.signTypedData({ domain, types, primaryType: "Mail", message });
    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "Mail",
      message,
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

describe("signerToWeb3LibAdapter", () => {
  it("getSignerAddress / getChainId / isSignerContract return the wired values", async () => {
    const signer = viemAccountSigner(account);
    const adapter = signerToWeb3LibAdapter(signer, 8453);
    expect(adapter.uuid).toBe("x402-client:signer-adapter");
    expect(await adapter.getSignerAddress()).toBe(account.address);
    expect(await adapter.getChainId()).toBe(8453);
    expect(await adapter.isSignerContract()).toBe(false);
  });

  it("send('eth_signTypedData_v4', [addr, json]) parses the JSON and delegates to the signer", async () => {
    const signer = viemAccountSigner(account);
    const adapter = signerToWeb3LibAdapter(signer, 8453);
    const typedData = { domain, types, primaryType: "Mail", message };
    const sig = await adapter.send("eth_signTypedData_v4", [
      account.address,
      JSON.stringify(typedData),
    ]);
    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "Mail",
      message,
      signature: sig as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("send rejects RPC methods other than eth_signTypedData_v4", async () => {
    const adapter = signerToWeb3LibAdapter(viemAccountSigner(account), 8453);
    await expect(adapter.send("eth_chainId", [])).rejects.toThrow(/does not support RPC method/);
  });

  it("send rejects when the typed-data payload isn't a JSON string", async () => {
    const adapter = signerToWeb3LibAdapter(viemAccountSigner(account), 8453);
    await expect(
      adapter.send("eth_signTypedData_v4", [account.address, { not: "a string" }]),
    ).rejects.toThrow(/not a JSON string/);
  });

  it("transaction-flavour methods reject with an 'unreachable' error", async () => {
    const adapter = signerToWeb3LibAdapter(viemAccountSigner(account), 8453);
    await expect(adapter.sendTransaction({})).rejects.toThrow(/never goes on-chain/);
    await expect(adapter.call({})).rejects.toThrow(/never goes on-chain/);
    await expect(adapter.estimateGas({})).rejects.toThrow(/never goes on-chain/);
    await expect(adapter.getBalance("0x0")).rejects.toThrow(/never goes on-chain/);
    await expect(adapter.getTransactionReceipt("0x0")).rejects.toThrow(/never goes on-chain/);
    await expect(adapter.getCurrentTimeMs()).rejects.toThrow(/never goes on-chain/);
  });
});

import { describe, expect, it } from "vitest";

import {
  createThrowingWeb3LibAdapter,
  createTypedDataInterceptAdapter,
  unreachable,
} from "../../src/internal/web3lib-stub.js";

const TAG = "x402-core-test";
const BUYER = "0x2222222222222222222222222222222222222222" as const;

describe("createThrowingWeb3LibAdapter", () => {
  it("uuid is namespaced with the caller tag", () => {
    expect(createThrowingWeb3LibAdapter(TAG).uuid).toBe(`${TAG}:stub`);
  });

  it("every method rejects with the loud unreachable error", async () => {
    const a = createThrowingWeb3LibAdapter(TAG);
    const methods = [
      "getSignerAddress",
      "isSignerContract",
      "getChainId",
      "getBalance",
      "estimateGas",
      "sendTransaction",
      "call",
      "send",
      "getTransactionReceipt",
      "getCurrentTimeMs",
    ] as const;
    for (const m of methods) {
      const fn = a[m] as () => Promise<unknown>;
      await expect(fn()).rejects.toThrow(
        new RegExp(`${TAG}: stub Web3LibAdapter\\.${m}\\(\\) should never be called`),
      );
    }
  });
});

describe("unreachable", () => {
  it("error message includes the caller tag and method name", () => {
    const e = unreachable(TAG, "send");
    expect(e.message).toContain(TAG);
    expect(e.message).toContain("send()");
  });
});

describe("createTypedDataInterceptAdapter", () => {
  it("captures JSON typed-data passed to eth_signTypedData_v4 via parse()", async () => {
    const intercept = createTypedDataInterceptAdapter<{ hello: string }>({
      callerTag: TAG,
      signerAddress: BUYER,
      chainId: 8453,
      parse: (json) => JSON.parse(json) as { hello: string },
    });
    const payload = JSON.stringify({ hello: "world" });
    const sig = await intercept.adapter.send("eth_signTypedData_v4", [BUYER, payload]);
    expect(sig).toMatch(/^0x[0-9a-f]+$/);
    expect(intercept.read()).toEqual({ hello: "world" });
  });

  it("getSignerAddress and getChainId report the caller-supplied values", async () => {
    const intercept = createTypedDataInterceptAdapter<unknown>({
      callerTag: TAG,
      signerAddress: BUYER,
      chainId: 8453,
      parse: () => null,
    });
    await expect(intercept.adapter.getSignerAddress()).resolves.toBe(BUYER);
    await expect(intercept.adapter.getChainId()).resolves.toBe(8453);
    await expect(intercept.adapter.isSignerContract("0x0")).resolves.toBe(false);
  });

  it("rejects non-typed-data RPC methods loudly", async () => {
    const intercept = createTypedDataInterceptAdapter<unknown>({
      callerTag: TAG,
      signerAddress: BUYER,
      chainId: 8453,
      parse: () => null,
    });
    await expect(intercept.adapter.send("eth_sendTransaction", [])).rejects.toThrow(
      /unexpected RPC method during typed-data capture: eth_sendTransaction/,
    );
  });

  it("non-RPC methods reject with the shared unreachable error", async () => {
    const intercept = createTypedDataInterceptAdapter<unknown>({
      callerTag: TAG,
      signerAddress: BUYER,
      chainId: 8453,
      parse: () => null,
    });
    await expect(intercept.adapter.sendTransaction({})).rejects.toThrow(/should never be called/);
  });

  it("read() returns undefined before send() fires", () => {
    const intercept = createTypedDataInterceptAdapter<unknown>({
      callerTag: TAG,
      signerAddress: BUYER,
      chainId: 8453,
      parse: () => null,
    });
    expect(intercept.read()).toBeUndefined();
  });
});

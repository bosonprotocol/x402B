// Unit tests for `signerFromEip1193`.
//
// Drives the wrapper with a stubbed `provider.request` so the assertions
// focus on the RPC contract: which method names are issued for address
// resolution, what `eth_signTypedData_v4` receives as parameters
// (including the derived `EIP712Domain` types list), and how malformed
// provider responses surface as errors.

import { describe, expect, it, vi, type Mock } from "vitest";

import { signerFromEip1193, type Eip1193Provider } from "../src/signer-from-eip1193.js";
import {
  ALICE_CHECKSUM,
  ALICE_LOWER,
  BOB_CHECKSUM,
  BOB_LOWER,
  sampleTypedData,
} from "./fixtures.js";

const SIG = "0x" + "ab".repeat(65);
const SIG_2 = "0x" + "cd".repeat(65);

function makeProvider(handler: (method: string, params?: unknown) => unknown): Eip1193Provider & {
  request: Mock;
} {
  return {
    request: vi.fn(async ({ method, params }) => handler(method, params)),
  };
}

describe("signerFromEip1193 — getAddress", () => {
  it("uses eth_accounts by default and returns the first account checksummed", async () => {
    const provider = makeProvider((method) => {
      if (method === "eth_accounts") return [ALICE_LOWER];
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);
    expect(await signer.getAddress()).toBe(ALICE_CHECKSUM);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it("uses eth_requestAccounts when requestAccounts:true", async () => {
    const provider = makeProvider((method) => {
      if (method === "eth_requestAccounts") return [ALICE_LOWER];
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider, { requestAccounts: true });
    expect(await signer.getAddress()).toBe(ALICE_CHECKSUM);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("the explicit `account` option skips the RPC round-trip", async () => {
    const provider = makeProvider(() => {
      throw new Error("provider.request should not be called");
    });

    const signer = signerFromEip1193(provider, { account: ALICE_LOWER });
    expect(await signer.getAddress()).toBe(ALICE_CHECKSUM);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("throws when the provider returns an empty account list", async () => {
    const provider = makeProvider(() => []);
    const signer = signerFromEip1193(provider);
    await expect(signer.getAddress()).rejects.toThrowError(/no accounts/);
  });

  it("throws when the provider returns a non-array", async () => {
    const provider = makeProvider(() => null);
    const signer = signerFromEip1193(provider);
    await expect(signer.getAddress()).rejects.toThrowError(/no accounts/);
  });

  it("propagates provider.request rejections (e.g. user denied, wallet locked)", async () => {
    // EIP-1193 error code 4001 = "user rejected request". The adapter must
    // not swallow or rewrap these — callers rely on the original error
    // (code + message) to decide UX (e.g. show "connect wallet").
    const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const provider: Eip1193Provider = {
      request: vi.fn(async () => {
        throw rejection;
      }),
    };

    const signer = signerFromEip1193(provider);
    await expect(signer.getAddress()).rejects.toBe(rejection);
  });
});

describe("signerFromEip1193 — signTypedData", () => {
  it("issues eth_signTypedData_v4 with the resolved address and a JSON-stringified typed-data payload", async () => {
    const provider = makeProvider((method, params) => {
      if (method === "eth_accounts") return [ALICE_LOWER];
      if (method === "eth_signTypedData_v4") {
        const [from, json] = params as [string, string];
        expect(from).toBe(ALICE_CHECKSUM);
        const parsed = JSON.parse(json);
        expect(parsed.primaryType).toBe("Hello");
        expect(parsed.domain).toEqual(sampleTypedData.domain);
        expect(parsed.message).toEqual(sampleTypedData.message);
        expect(parsed.types.Hello).toEqual(sampleTypedData.types.Hello);
        // EIP712Domain types list must be injected and match the fields
        // present on the domain (name/version/chainId/verifyingContract).
        expect(parsed.types.EIP712Domain).toEqual([
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ]);
        return SIG;
      }
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);
    const sig = await signer.signTypedData(sampleTypedData);
    expect(sig).toBe(SIG);
  });

  it("throws when the provider does not return a hex signature string", async () => {
    const provider = makeProvider((method) => {
      if (method === "eth_accounts") return [ALICE_LOWER];
      if (method === "eth_signTypedData_v4") return null;
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);
    await expect(signer.signTypedData(sampleTypedData)).rejects.toThrowError(
      /hex signature string/,
    );
  });

  it("throws when the provider returns a malformed (non-hex) signature", async () => {
    const provider = makeProvider((method) => {
      if (method === "eth_accounts") return [ALICE_LOWER];
      if (method === "eth_signTypedData_v4") return "not-hex";
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);
    await expect(signer.signTypedData(sampleTypedData)).rejects.toThrowError(
      /hex signature string/,
    );
  });

  it("propagates provider.request rejections from eth_signTypedData_v4 (e.g. user denied)", async () => {
    const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const provider = makeProvider((method) => {
      if (method === "eth_accounts") return [ALICE_LOWER];
      if (method === "eth_signTypedData_v4") throw rejection;
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);
    await expect(signer.signTypedData(sampleTypedData)).rejects.toBe(rejection);
  });

  it("re-resolves the signing address on each call so wallet account switches between signatures are picked up", async () => {
    // First eth_accounts → Alice, second → Bob. Guards against a future
    // refactor that memoizes the resolved address on the closure.
    let accountsCallCount = 0;
    const provider = makeProvider((method, params) => {
      if (method === "eth_accounts") {
        accountsCallCount += 1;
        return [accountsCallCount === 1 ? ALICE_LOWER : BOB_LOWER];
      }
      if (method === "eth_signTypedData_v4") {
        const [from] = params as [string, string];
        return from === ALICE_CHECKSUM ? SIG : SIG_2;
      }
      throw new Error(`unexpected method ${method}`);
    });

    const signer = signerFromEip1193(provider);

    const firstSig = await signer.signTypedData(sampleTypedData);
    const secondSig = await signer.signTypedData(sampleTypedData);

    expect(firstSig).toBe(SIG);
    expect(secondSig).toBe(SIG_2);

    const signCalls = provider.request.mock.calls
      .map(([arg]) => arg as { method: string; params?: unknown[] })
      .filter((arg) => arg.method === "eth_signTypedData_v4");
    expect(signCalls).toHaveLength(2);
    expect((signCalls[0].params as [string, string])[0]).toBe(ALICE_CHECKSUM);
    expect((signCalls[1].params as [string, string])[0]).toBe(BOB_CHECKSUM);
  });
});

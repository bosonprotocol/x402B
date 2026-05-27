import { describe, expect, it } from "vitest";
import { ContractFunctionExecutionError, type PublicClient } from "viem";

import { fetchTokenDomain } from "../../../src/eip712/token-auth/index.js";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const CHAIN_ID = 31337;

// Mimics the wrapper viem produces via `getContractError` — the outer
// throwable is always a `ContractFunctionExecutionError` regardless of
// the inner `cause` (revert / zero-data / etc.).
function contractFunctionError(message: string): ContractFunctionExecutionError {
  return new ContractFunctionExecutionError(new Error(message), {
    abi: [],
    functionName: "stub",
  });
}

// Same shape minus the prototype chain — exercises the name-based
// duck-type check in `fetchTokenDomain`. Mirrors what the paywall's
// browser IIFE bundle ends up with when esbuild inlines viem along
// several import chains and class identity stops being preserved.
function nameOnlyContractFunctionError(): Error {
  const e = new Error("ContractFunctionExecutionError (duck-typed)");
  e.name = "ContractFunctionExecutionError";
  return e;
}

interface Stubs {
  eip712Domain?: () => unknown;
  name?: () => unknown;
  version?: () => unknown;
}

function buildClient(stubs: Stubs): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      const stub = stubs[functionName as keyof Stubs];
      if (!stub) throw new Error(`unexpected readContract call: ${functionName}`);
      return stub();
    },
  } as unknown as PublicClient;
}

describe("fetchTokenDomain", () => {
  it("returns the EIP-5267 result when the token implements eip712Domain()", async () => {
    const client = buildClient({
      eip712Domain: () =>
        ["0x0f", "USD Coin", "2", 8453n, TOKEN, `0x${"00".repeat(32)}`, []] as const,
    });
    const domain = await fetchTokenDomain(client, TOKEN, CHAIN_ID);
    expect(domain).toEqual({
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: TOKEN,
    });
  });

  it("includes salt when the EIP-5267 fields bitmask sets the salt bit (0x10)", async () => {
    const salt = `0x${"ab".repeat(32)}` as const;
    const client = buildClient({
      // 0x1f = name|version|chainId|verifyingContract|salt
      eip712Domain: () => ["0x1f", "USD Coin", "2", 8453n, TOKEN, salt, []] as const,
    });
    expect(await fetchTokenDomain(client, TOKEN, CHAIN_ID)).toEqual({
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: TOKEN,
      salt,
    });
  });

  it("drops a non-zero salt when the fields bitmask leaves the salt bit unset", async () => {
    const client = buildClient({
      // 0x0f leaves the salt bit (0x10) unset, so the returned salt is
      // not part of the domain and must not be carried through.
      eip712Domain: () =>
        ["0x0f", "USD Coin", "2", 8453n, TOKEN, `0x${"ab".repeat(32)}`, []] as const,
    });
    expect(await fetchTokenDomain(client, TOKEN, CHAIN_ID)).toEqual({
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: TOKEN,
    });
  });

  it("falls back to name() + version() when eip712Domain() throws a ContractFunctionExecutionError", async () => {
    const client = buildClient({
      eip712Domain: () => {
        throw contractFunctionError("function selector was not recognized");
      },
      name: () => "ERC3009Token",
      version: () => "2",
    });
    expect(await fetchTokenDomain(client, TOKEN, CHAIN_ID)).toEqual({
      name: "ERC3009Token",
      version: "2",
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    });
  });

  it("falls back even when the thrown error only matches by name (regression: dual viem instances in browser bundle)", async () => {
    const client = buildClient({
      eip712Domain: () => {
        throw nameOnlyContractFunctionError();
      },
      name: () => "ERC3009Token",
      version: () => "1",
    });
    expect(await fetchTokenDomain(client, TOKEN, CHAIN_ID)).toEqual({
      name: "ERC3009Token",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    });
  });

  it("defaults version to '1' when version() reverts (EIP-2612 default)", async () => {
    const client = buildClient({
      eip712Domain: () => {
        throw contractFunctionError("eip712Domain not implemented");
      },
      name: () => "ERC3009Token",
      version: () => {
        throw contractFunctionError("version() not implemented");
      },
    });
    expect(await fetchTokenDomain(client, TOKEN, CHAIN_ID)).toEqual({
      name: "ERC3009Token",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    });
  });

  it("propagates transport-level errors (plain Error) without falling back", async () => {
    const transportError = new Error("ECONNREFUSED: RPC unreachable");
    const client = buildClient({
      eip712Domain: () => {
        throw transportError;
      },
    });
    await expect(fetchTokenDomain(client, TOKEN, CHAIN_ID)).rejects.toBe(transportError);
  });
});

// Translator that wraps a `Signer` (plus an optional viem `PublicClient`
// for read-only RPC calls) into a `Web3LibAdapter` that `CoreSDK` can be
// constructed against.
//
// Two RPC methods are forwarded:
//
//   - `send("eth_signTypedData_v4", ...)` — buyer signs via `signer.signTypedData`.
//   - `call({ to, data })` — read-only `eth_call`, forwarded to the
//     `PublicClient` when one is configured. Required by the EIP-2612
//     Permit token-auth path, which fetches the token's `nonces(owner)`
//     before signing. Throws a clear error when invoked without a
//     PublicClient so the configuration mistake surfaces fast.
//
// Transaction-flavour methods (`sendTransaction`, `estimateGas`,
// `getBalance`, `getTransactionReceipt`, `getCurrentTimeMs`) reject — the
// buyer never goes on-chain in MVP.

import type { Web3LibAdapter } from "@bosonprotocol/common";
import type { PublicClient, TypedDataDomain, TypedDataParameter } from "viem";

import type { Signer } from "../types.js";

/**
 * Build the `Web3LibAdapter` that `@bosonprotocol/core-sdk`'s `CoreSDK`
 * accepts. `send("eth_signTypedData_v4", [address, jsonString])` delegates
 * to `signer.signTypedData(...)`. `call({ to, data })` is forwarded to
 * `publicClient.call(...)` when one is provided; otherwise it throws (the
 * Permit strategy is the only path that exercises `call`).
 */
export function signerToWeb3LibAdapter(
  signer: Signer,
  chainId: number,
  publicClient?: PublicClient,
): Web3LibAdapter {
  return {
    uuid: "x402-client:signer-adapter",
    getSignerAddress: () => signer.getAddress(),
    isSignerContract: async () => false,
    getChainId: async () => chainId,
    send: async (method, params) => {
      if (method !== "eth_signTypedData_v4") {
        throw new Error(
          `x402-client: signer adapter does not support RPC method '${method}'; only eth_signTypedData_v4 is implemented`,
        );
      }
      const raw = (params as unknown[])[1];
      if (typeof raw !== "string") {
        throw new Error(
          "x402-client: eth_signTypedData_v4 payload[1] is not a JSON string — core-sdk internals may have changed",
        );
      }
      const typedData = JSON.parse(raw) as {
        domain: TypedDataDomain;
        types: Record<string, readonly TypedDataParameter[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      return signer.signTypedData(typedData);
    },
    call: async (req) => {
      if (!publicClient) {
        throw new Error(
          "x402-client: signer adapter has no PublicClient configured; eth_call cannot be forwarded. " +
            "Pass `publicClients` in X402bClientConfig to enable the Permit token-auth strategy.",
        );
      }
      const result = await publicClient.call({
        to: req.to as `0x${string}`,
        data: req.data as `0x${string}` | undefined,
      });
      return result.data ?? "0x";
    },
    getBalance: () => Promise.reject(unreachable("getBalance")),
    estimateGas: () => Promise.reject(unreachable("estimateGas")),
    sendTransaction: () => Promise.reject(unreachable("sendTransaction")),
    getTransactionReceipt: () => Promise.reject(unreachable("getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable("getCurrentTimeMs")),
  };
}

function unreachable(method: string): Error {
  return new Error(
    `x402-client: stub Web3LibAdapter.${method}() is not implemented — the client never goes on-chain in MVP`,
  );
}

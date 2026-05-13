// Signer adapters. Two viem helpers cover the common cases; a third
// translator wraps a `Signer` into a `Web3LibAdapter` that `CoreSDK` can be
// constructed against — only the `send("eth_signTypedData_v4", ...)` path
// is implemented, since the buyer never goes on-chain in MVP (no transaction
// sending, no balance lookups, no RPC reads). Transaction-flavour methods
// reject with a clear `unreachable(...)` so misuse fails loudly rather than
// silently calling into an unset RPC.

import type { Web3LibAdapter } from "@bosonprotocol/common";
import type {
  Account,
  LocalAccount,
  TypedDataDomain,
  TypedDataParameter,
  WalletClient,
} from "viem";

import type { Signer } from "../types.js";

export type { Signer };

/** Wrap a viem `LocalAccount` (private-key / mnemonic account) as a `Signer`. */
export function viemAccountSigner(account: LocalAccount): Signer {
  return {
    getAddress: async () => account.address,
    signTypedData: (args) =>
      account.signTypedData(args as unknown as Parameters<LocalAccount["signTypedData"]>[0]),
  };
}

/**
 * Wrap a viem `WalletClient` plus an `Account` as a `Signer`. Use this when
 * the buyer's keys live behind an RPC signer (browser wallet, hardware
 * wallet, remote signer) rather than in-process.
 */
export function viemWalletClientSigner(walletClient: WalletClient, account: Account): Signer {
  return {
    getAddress: async () => account.address,
    signTypedData: (args) =>
      walletClient.signTypedData({
        account,
        domain: args.domain,
        types: args.types as unknown as Parameters<WalletClient["signTypedData"]>[0]["types"],
        primaryType: args.primaryType,
        message: args.message,
      } as Parameters<WalletClient["signTypedData"]>[0]),
  };
}

/**
 * Build the `Web3LibAdapter` that `@bosonprotocol/core-sdk`'s `CoreSDK`
 * accepts. `send("eth_signTypedData_v4", [address, jsonString])` is the
 * only RPC method actually exercised during meta-tx signing — it delegates
 * to `signer.signTypedData(...)`. Read-only adapter methods are filled in
 * with trivial answers; transaction-flavour methods throw on first call.
 */
export function signerToWeb3LibAdapter(signer: Signer, chainId: number): Web3LibAdapter {
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
    getBalance: () => Promise.reject(unreachable("getBalance")),
    estimateGas: () => Promise.reject(unreachable("estimateGas")),
    sendTransaction: () => Promise.reject(unreachable("sendTransaction")),
    call: () => Promise.reject(unreachable("call")),
    getTransactionReceipt: () => Promise.reject(unreachable("getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable("getCurrentTimeMs")),
  };
}

function unreachable(method: string): Error {
  return new Error(
    `x402-client: stub Web3LibAdapter.${method}() is not implemented — the client never goes on-chain in MVP`,
  );
}

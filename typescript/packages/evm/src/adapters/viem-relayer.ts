// Viem-backed `Web3LibAdapter` for relayer / facilitator-style flows where
// a configured `WalletClient` submits transactions on a buyer's behalf.
//
// `@bosonprotocol/core-sdk`'s `MetaTxMixin.executeMetaTransaction(...)`
// (the unified entrypoint that routes between
// `executeMetaTransaction` and `executeMetaTransactionWithTokenTransferAuthorization`
// based on whether `transferAuthorizations` is provided) drives every
// on-chain side-effect through the SDK's `Web3LibAdapter`. This adapter
// wraps a viem `WalletClient` (for writes) plus a `PublicClient`
// (for reads / receipt polling) so the SDK can run end-to-end against
// viem-configured transports.
//
// The sibling `client/src/internal/web3lib-adapter.ts` wraps a sign-only
// `Signer` for the buyer path; this is the symmetric write-only variant
// for the relayer path. Future work may consolidate them behind a
// single factory.

import type { Web3LibAdapter } from "@bosonprotocol/common";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  RawContractError,
  type PublicClient,
  type WalletClient,
} from "viem";

/** Tagged error thrown by the adapter when `walletClient.sendTransaction` rejects. */
export class RelayerSubmitError extends Error {
  readonly code: RelayerSubmitErrorCode;
  constructor(code: RelayerSubmitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RelayerSubmitError";
    this.code = code;
  }
}

/** Stable identifiers callers can map to their own error-code vocabulary. */
export type RelayerSubmitErrorCode =
  | "INSUFFICIENT_FUNDS_FOR_GAS"
  | "ONCHAIN_REVERT"
  | "INTERNAL_ERROR";

/** Default deadline for `wait()` when the caller does not override. */
const DEFAULT_RECEIPT_TIMEOUT_MS = 60_000;

/**
 * Build the `Web3LibAdapter` that `@bosonprotocol/core-sdk`'s `CoreSDK`
 * accepts for relayer-driven flows.
 *
 * - Writes flow through `walletClient.sendTransaction`; viem errors are
 *   re-thrown as a tagged `RelayerSubmitError` so the caller can keep
 *   precise classification (insufficient gas funds vs. on-chain revert
 *   vs. transport failure).
 * - Reads (`call`, `getBalance`, `estimateGas`, `getTransactionReceipt`)
 *   flow through `publicClient`.
 * - `send` rejects: the relayer never signs typed data through the
 *   adapter (the buyer already signed off-chain).
 *
 * If either client carries a `chain` (viem populates it when the client
 * was built with an explicit chain) the factory cross-checks its id
 * against the supplied `chainId` and rejects mismatches up-front, so a
 * misconfigured pair fails loudly rather than silently targeting the
 * wrong network.
 */
export function walletClientToWeb3LibAdapter(params: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  chainId: number;
  /**
   * Per-call timeout (ms) passed to `publicClient.waitForTransactionReceipt`
   * inside the adapter's `wait()` method, so callers that route through
   * core-sdk's `TransactionResponse.wait()` don't hang indefinitely on a
   * stalled RPC. Defaults to 60s. Direct callers that drive their own
   * receipt polling can ignore it.
   */
  receiptTimeoutMs?: number;
}): Web3LibAdapter {
  const { walletClient, publicClient, chainId } = params;
  const receiptTimeoutMs = params.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS;
  if (walletClient.chain && walletClient.chain.id !== chainId) {
    throw new RelayerSubmitError(
      "INTERNAL_ERROR",
      `walletClient.chain.id (${walletClient.chain.id}) does not match adapter chainId (${chainId})`,
    );
  }
  if (publicClient.chain && publicClient.chain.id !== chainId) {
    throw new RelayerSubmitError(
      "INTERNAL_ERROR",
      `publicClient.chain.id (${publicClient.chain.id}) does not match adapter chainId (${chainId})`,
    );
  }
  return {
    uuid: "x402-evm:viem-relayer-adapter",
    getSignerAddress: async () => {
      const account = walletClient.account;
      if (!account) {
        throw new RelayerSubmitError(
          "INTERNAL_ERROR",
          "walletClient has no account; cannot resolve signer address",
        );
      }
      return account.address;
    },
    isSignerContract: async () => false,
    getChainId: async () => chainId,
    getBalance: async (addressOrName) => {
      const balance = await publicClient.getBalance({ address: addressOrName as `0x${string}` });
      return balance;
    },
    estimateGas: async (req) => {
      const account = walletClient.account;
      const gas = await publicClient.estimateGas({
        account: account ?? undefined,
        to: req.to as `0x${string}` | undefined,
        data: req.data as `0x${string}` | undefined,
        value: req.value === undefined ? undefined : BigInt(req.value.toString()),
      });
      return gas;
    },
    sendTransaction: async (req) => {
      const account = walletClient.account;
      if (!account) {
        throw new RelayerSubmitError(
          "INTERNAL_ERROR",
          "walletClient has no account; cannot send transaction",
        );
      }
      let hash: `0x${string}`;
      try {
        hash = await walletClient.sendTransaction({
          account,
          chain: walletClient.chain ?? null,
          to: req.to as `0x${string}` | undefined,
          data: req.data as `0x${string}` | undefined,
          value: req.value === undefined ? 0n : BigInt(req.value.toString()),
        });
      } catch (e) {
        throw classifyViemSendError(e);
      }
      return {
        hash,
        wait: async (_confirmations?: number) => {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: receiptTimeoutMs,
          });
          return {
            from: receipt.from,
            to: receipt.to ?? "",
            status: receipt.status === "success" ? 1 : 0,
            logs: receipt.logs.map((log) => ({ data: log.data, topics: [...log.topics] })),
            transactionHash: receipt.transactionHash,
            effectiveGasPrice: receipt.effectiveGasPrice,
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed,
          };
        },
      };
    },
    call: async (req) => {
      const result = await publicClient.call({
        to: req.to as `0x${string}` | undefined,
        data: req.data as `0x${string}` | undefined,
      });
      return result.data ?? "0x";
    },
    send: async (method) => {
      throw new RelayerSubmitError(
        "INTERNAL_ERROR",
        `x402-evm: relayer adapter does not support RPC method '${method}'; the relayer never signs typed data`,
      );
    },
    getTransactionReceipt: async (txHash) => {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      return {
        from: receipt.from,
        to: receipt.to ?? "",
        status: receipt.status === "success" ? 1 : 0,
        logs: receipt.logs.map((log) => ({ data: log.data, topics: [...log.topics] })),
        transactionHash: receipt.transactionHash,
        effectiveGasPrice: receipt.effectiveGasPrice,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed,
      };
    },
    getCurrentTimeMs: async () => Date.now(),
  };
}

/** Classify a viem error thrown by `walletClient.sendTransaction`. */
export function classifyViemSendError(e: unknown): RelayerSubmitError {
  const reason =
    e instanceof Error ? `sendTransaction failed: ${e.message}` : "sendTransaction failed";

  if (hasViemCause(e, InsufficientFundsError)) {
    return new RelayerSubmitError("INSUFFICIENT_FUNDS_FOR_GAS", reason, { cause: e });
  }
  if (
    hasViemCause(e, ExecutionRevertedError) ||
    hasViemCause(e, ContractFunctionRevertedError) ||
    hasViemCause(e, RawContractError)
  ) {
    return new RelayerSubmitError("ONCHAIN_REVERT", reason, { cause: e });
  }
  return new RelayerSubmitError("INTERNAL_ERROR", reason, { cause: e });
}

function hasViemCause<T extends abstract new (...args: never[]) => Error>(
  e: unknown,
  ctor: T,
): boolean {
  if (e instanceof ctor) return true;
  if (!(e instanceof BaseError)) return false;
  return e.walk((err) => err instanceof ctor) !== null;
}

// Shared stub `Web3LibAdapter` factories.
//
// `@bosonprotocol/core-sdk`'s signing helpers all take a `Web3LibAdapter`
// even when no signing actually happens — e.g. `signFullOffer({
// returnTypedDataToSign: true })` and `signMetaTx` are typed-data-only paths
// where the adapter is structural baggage. We pass a stub adapter whose
// methods throw if invoked, so that any future leak into a non-signing-only
// path is loud rather than silent.
//
// Two flavours live here:
//
//   - {@link createThrowingWeb3LibAdapter} — every method rejects. Used by
//     `eip712/full-offer.ts` (which truly invokes nothing).
//   - {@link createTypedDataInterceptAdapter} — captures the structured
//     data passed to `eth_signTypedData_v4` and otherwise rejects. Used by
//     `eip712/meta-transaction.ts` to extract the typed-data core-sdk
//     would otherwise ship straight to a wallet.
//
// This module is internal — not part of the package's public `exports`
// map. Consumers stay on the public typed-data builders; the stubs are
// kept here so the same loud-error idiom is shared in one place.
//
// {@link unreachable} is exported for callers (e.g. the intercept adapter)
// that need to compose a custom adapter and want the same error wording.

import type { Web3LibAdapter } from "@bosonprotocol/common";
import type { Hex } from "viem";

/** Error builder for stub methods that should never be invoked. */
export function unreachable(callerTag: string, method: string): Error {
  return new Error(
    `${callerTag}: stub Web3LibAdapter.${method}() should never be called. ` +
      `If you see this, either core-sdk changed its behaviour or the stub leaked ` +
      `into a non-signing-only path — file a bug.`,
  );
}

/**
 * Build a `Web3LibAdapter` whose every method rejects with {@link unreachable}.
 * `callerTag` is interpolated into the error message so the offending stub
 * site is greppable from production logs.
 */
export function createThrowingWeb3LibAdapter(callerTag: string): Web3LibAdapter {
  return {
    uuid: `${callerTag}:stub`,
    getSignerAddress: () => Promise.reject(unreachable(callerTag, "getSignerAddress")),
    isSignerContract: () => Promise.reject(unreachable(callerTag, "isSignerContract")),
    getChainId: () => Promise.reject(unreachable(callerTag, "getChainId")),
    getBalance: () => Promise.reject(unreachable(callerTag, "getBalance")),
    estimateGas: () => Promise.reject(unreachable(callerTag, "estimateGas")),
    sendTransaction: () => Promise.reject(unreachable(callerTag, "sendTransaction")),
    call: () => Promise.reject(unreachable(callerTag, "call")),
    send: () => Promise.reject(unreachable(callerTag, "send")),
    getTransactionReceipt: () => Promise.reject(unreachable(callerTag, "getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable(callerTag, "getCurrentTimeMs")),
  };
}

/** Bag returned by {@link createTypedDataInterceptAdapter}. */
export interface TypedDataIntercept<T> {
  adapter: Web3LibAdapter;
  /** Whatever the intercept captured, or `undefined` if `send` never fired. */
  read(): T | undefined;
}

/**
 * Build a `Web3LibAdapter` that captures the second argument to
 * `send("eth_signTypedData_v4", [from, json])` (a JSON-encoded typed-data
 * object), parses it through `parse`, and stores the result for later
 * retrieval. `getSignerAddress`, `isSignerContract`, and `getChainId` are
 * answered locally so core-sdk's signing helpers don't blow up; every
 * other method rejects with {@link unreachable}.
 *
 * The 65-byte `dummySignature` returned from `send` is unused downstream —
 * core-sdk's `getSignatureParameters` only slices it without validation.
 */
export function createTypedDataInterceptAdapter<T>(args: {
  callerTag: string;
  signerAddress: `0x${string}`;
  chainId: number;
  parse: (jsonPayload: string) => T;
  dummySignature?: Hex;
}): TypedDataIntercept<T> {
  const dummy = args.dummySignature ?? DEFAULT_DUMMY_SIGNATURE_65;
  let captured: T | undefined;

  const adapter: Web3LibAdapter = {
    uuid: `${args.callerTag}:typed-data-intercept`,
    getSignerAddress: () => Promise.resolve(args.signerAddress),
    isSignerContract: () => Promise.resolve(false),
    getChainId: () => Promise.resolve(args.chainId),
    send: async (method, params) => {
      if (method !== "eth_signTypedData_v4") {
        throw new Error(
          `${args.callerTag}: unexpected RPC method during typed-data capture: ${method}`,
        );
      }
      const json = (params as unknown[])[1];
      if (typeof json !== "string") {
        throw new Error(`${args.callerTag}: eth_signTypedData_v4 payload is not a JSON string`);
      }
      captured = args.parse(json);
      return dummy;
    },
    getBalance: () => Promise.reject(unreachable(args.callerTag, "getBalance")),
    estimateGas: () => Promise.reject(unreachable(args.callerTag, "estimateGas")),
    sendTransaction: () => Promise.reject(unreachable(args.callerTag, "sendTransaction")),
    call: () => Promise.reject(unreachable(args.callerTag, "call")),
    getTransactionReceipt: () =>
      Promise.reject(unreachable(args.callerTag, "getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable(args.callerTag, "getCurrentTimeMs")),
  };

  return { adapter, read: () => captured };
}

// Any 65-byte hex; the value is irrelevant — core-sdk's
// `getSignatureParameters` only slices it without validation.
const DEFAULT_DUMMY_SIGNATURE_65: Hex = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;

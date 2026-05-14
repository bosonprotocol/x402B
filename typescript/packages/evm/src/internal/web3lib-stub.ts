// Calldata-only `Web3LibAdapter` for the calldata-builder modules.
//
// Core-sdk's `signMetaTx` calls `web3Lib.getSignerAddress()` even in
// `returnTypedDataToSign: true` mode (to fill the message's `from`
// field). We return a deterministic dummy address — the resulting
// `from` ends up baked into the discarded typed-data portion, not the
// `{ functionName, functionSignature }` pair the verifier consumes.
//
// All signing- and transaction-flavour methods reject so the stub fails
// loudly if it ever leaks into a path that needs more than the
// typed-data-only contract.

import type { Web3LibAdapter } from "@bosonprotocol/common";

/** Deterministic dummy returned for `getSignerAddress` — not the zero address, so any "did someone forget to set the signer" check still finds something. */
const DUMMY_SIGNER_ADDRESS = "0x0000000000000000000000000000000000000001";

function unreachable(callerTag: string, method: string): Error {
  return new Error(
    `${callerTag}: stub Web3LibAdapter.${method}() should never be called. ` +
      `If you see this, either core-sdk changed its behaviour or the stub leaked ` +
      `into a non-typed-data-only path — file a bug.`,
  );
}

export function createCalldataOnlyWeb3LibAdapter(callerTag: string): Web3LibAdapter {
  return {
    uuid: `${callerTag}:stub`,
    getSignerAddress: () => Promise.resolve(DUMMY_SIGNER_ADDRESS),
    isSignerContract: () => Promise.resolve(false),
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

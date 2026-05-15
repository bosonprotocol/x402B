// Minimal throwing `Web3LibAdapter` for the server's read-only
// `CoreSDK` instance. The funds-subgraph and accounts-subgraph helpers
// (`getFunds`, `getSellersByAddress`, `getBuyers`) never touch the
// adapter at runtime, but `new CoreSDK({...})` requires one in its
// constructor. Each method throws so any future leak into a non-read
// path is loud rather than silent.

import type { Web3LibAdapter } from "@bosonprotocol/common";

const TAG = "x402-server:read";

function unreachable(method: string): Error {
  return new Error(
    `${TAG}: stub Web3LibAdapter.${method}() should never be called from the read-only ` +
      `CoreSDK instance. If you see this, a non-subgraph code path leaked through.`,
  );
}

export function createReadOnlyWeb3LibStub(): Web3LibAdapter {
  return {
    uuid: `${TAG}:stub`,
    getSignerAddress: () => Promise.reject(unreachable("getSignerAddress")),
    isSignerContract: () => Promise.reject(unreachable("isSignerContract")),
    getChainId: () => Promise.reject(unreachable("getChainId")),
    getBalance: () => Promise.reject(unreachable("getBalance")),
    estimateGas: () => Promise.reject(unreachable("estimateGas")),
    sendTransaction: () => Promise.reject(unreachable("sendTransaction")),
    call: () => Promise.reject(unreachable("call")),
    send: () => Promise.reject(unreachable("send")),
    getTransactionReceipt: () => Promise.reject(unreachable("getTransactionReceipt")),
    getCurrentTimeMs: () => Promise.reject(unreachable("getCurrentTimeMs")),
  };
}

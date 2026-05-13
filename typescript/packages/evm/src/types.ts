// Shared TypeScript types for `@bosonprotocol/x402-evm` calldata builders.

import type { Address, Hex } from "viem";

/**
 * Minimal calldata payload for a `MetaTransactionsHandlerFacet.executeMetaTransaction`
 * inner action — what the buyer signs over inside the meta-tx envelope.
 *
 * - `functionName` is the Solidity function selector string the protocol uses
 *   when recovering the buyer's signature (e.g.
 *   `"createOfferAndCommit((... long tuple ...),address,address,bytes,uint256,...)"`).
 *   Must match byte-for-byte the literal core-sdk's
 *   `meta-tx/handler.ts` uses for the same action, since the meta-tx
 *   typed-data hashes it as a `string`.
 * - `functionSignature` is the ABI-encoded call data (selector + args) for
 *   the action itself.
 */
export interface InnerActionCalldata {
  functionName: string;
  functionSignature: Hex;
}

/** Minimal viem-style transaction request that any wallet client can submit. */
export interface TxRequest {
  to: Address;
  data: Hex;
  /** Optional ETH value attached to the call. Defaults to 0n; only present for `payable` functions. */
  value?: bigint;
}

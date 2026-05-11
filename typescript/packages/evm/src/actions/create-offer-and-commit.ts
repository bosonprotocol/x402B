// Calldata builder for `ExchangeCommitFacet.createOfferAndCommit` —
// the "deferred-redemption" Boson action (Flow A in
// docs/boson-impl-02-flows.md).
//
// This is the *inner* action a buyer authorises through a Boson meta-tx
// envelope. The output is the `{ functionName, functionSignature }` pair
// that goes into the meta-tx typed-data the buyer signs, as built by
// `@bosonprotocol/x402-core/eip712`'s `metaTransactionTypedData`.
//
// `functionSignature` reuses `@bosonprotocol/core-sdk`'s
// `exchanges.iface.encodeCreateOfferAndCommit` so the bytes are
// byte-identical to what the protocol's `MetaTransactionsHandlerFacet`
// recovers and replays on-chain.
//
// `functionName` is hand-pinned to the exact selector string core-sdk's
// own `metaTx.handler.signMetaTxCreateOfferAndCommit` uses internally —
// the EIP-712 meta-tx hash includes it as a `string`, so any byte-level
// drift would cause the buyer's signature to recover to the wrong address
// on-chain. Inlined rather than exported as a constant: callers that need
// it read it back off the return value, and a stale exported constant
// would be the easiest way to introduce drift.

import { exchanges } from "@bosonprotocol/core-sdk";
import type { FullOfferArgs } from "@bosonprotocol/common";
import type { Hex } from "viem";

import type { InnerActionCalldata } from "../types.js";

export interface BuildCreateOfferAndCommitCalldataArgs {
  /**
   * Full BPIP-10 offer payload, identical in shape to what core-sdk's
   * `exchanges.iface.encodeCreateOfferAndCommit` accepts. The seller's
   * `signature` field is embedded inside this struct and is verified
   * on-chain by `verifyOffer`.
   */
  fullOffer: FullOfferArgs;
}

/**
 * Build the `{ functionName, functionSignature }` calldata pair for the
 * `createOfferAndCommit` inner action. Pass the result into
 * `@bosonprotocol/x402-core/eip712`'s `metaTransactionTypedData` to get
 * the EIP-712 typed-data the buyer signs.
 */
export function buildCreateOfferAndCommitCalldata(
  args: BuildCreateOfferAndCommitCalldataArgs,
): InnerActionCalldata {
  return {
    functionName:
      "createOfferAndCommit(((uint256,uint256,uint256,uint256,uint256,uint256,address,uint8,uint8,string,string,bool,uint256,(address[],uint256[])[],uint256),(uint256,uint256,uint256,uint256),(uint256,uint256,uint256),(uint256,address),(uint8,uint8,address,uint8,uint256,uint256,uint256,uint256),uint256,uint256,bool),address,address,bytes,uint256,(uint256,(address[],uint256[]),address))",
    functionSignature: exchanges.iface.encodeCreateOfferAndCommit(args.fullOffer) as Hex,
  };
}

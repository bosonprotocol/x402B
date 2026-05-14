// Calldata builder for `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` —
// the atomic "create offer + commit + redeem" Boson action (Flow B in
// docs/boson-impl-02-flows.md).
//
// Same delegation pattern as `./create-offer-and-commit.ts`: rather than
// hand-pin the `functionName` selector here, we route the whole
// `{ functionName, functionSignature }` pair through
// `@bosonprotocol/core-sdk`'s `metaTx.handler.signMetaTxCreateOfferCommitAndRedeem`
// in `returnTypedDataToSign: true` mode. That's the same helper the
// client uses to sign, so signing and verification share one source of
// truth — if a future SDK release changes either the selector literal
// or the ABI encoding, both paths track the change together.
//
// Note: the function-argument arity differs from `createOfferAndCommit`
// (this variant takes `(fullOffer, address committer, bytes sellerSig,
// uint256 agentId)` rather than the deferred-redeem path's longer
// signature). The SDK pins the matching literal internally.

import type { FullOfferArgs } from "@bosonprotocol/common";
import { metaTx } from "@bosonprotocol/core-sdk";
import type { Hex } from "viem";

import {
  DUMMY_CHAIN_ID,
  DUMMY_METATX_HANDLER_ADDRESS,
  DUMMY_NONCE,
} from "../internal/metatx-calldata-constants.js";
import { createCalldataOnlyWeb3LibAdapter } from "../internal/web3lib-stub.js";
import type { InnerActionCalldata } from "../types.js";

export interface BuildCreateOfferCommitAndRedeemCalldataArgs {
  /**
   * Full BPIP-10 offer payload, identical in shape to what core-sdk's
   * `orchestration.iface.encodeCreateOfferCommitAndRedeem` accepts. The
   * seller's `signature` field is embedded inside this struct and is
   * verified on-chain by `verifyOffer`.
   */
  fullOffer: FullOfferArgs;
}

const STUB_CALLER_TAG = "@bosonprotocol/x402-evm:create-offer-commit-and-redeem";

/**
 * Build the `{ functionName, functionSignature }` calldata pair for the
 * `createOfferCommitAndRedeem` inner action by delegating to core-sdk.
 */
export async function buildCreateOfferCommitAndRedeemCalldata(
  args: BuildCreateOfferCommitAndRedeemCalldataArgs,
): Promise<InnerActionCalldata> {
  const result = await metaTx.handler.signMetaTxCreateOfferCommitAndRedeem({
    web3Lib: createCalldataOnlyWeb3LibAdapter(STUB_CALLER_TAG),
    metaTxHandlerAddress: DUMMY_METATX_HANDLER_ADDRESS,
    chainId: DUMMY_CHAIN_ID,
    nonce: DUMMY_NONCE,
    createOfferAndCommitArgs: args.fullOffer,
    returnTypedDataToSign: true,
  });

  return {
    functionName: result.functionName,
    functionSignature: result.functionSignature as Hex,
  };
}

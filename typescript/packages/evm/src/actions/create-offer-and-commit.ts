// Calldata builder for `ExchangeCommitFacet.createOfferAndCommit` —
// the "deferred-redemption" Boson action (Flow A in
// docs/boson-impl-02-flows.md).
//
// Returns the `{ functionName, functionSignature }` pair the buyer's
// meta-tx typed-data is built over — same pair the on-chain
// `MetaTransactionsHandlerFacet` recovers signatures against.
//
// Implementation note: rather than hand-pin the `functionName` selector
// string and call `exchanges.iface.encodeCreateOfferAndCommit` here
// directly, we delegate the whole pair to
// `@bosonprotocol/core-sdk`'s `metaTx.handler.signMetaTxCreateOfferAndCommit`
// in `returnTypedDataToSign: true` mode. That's the *same* helper the
// client uses to sign, so both signing and verification source the
// `functionName` literal + `functionSignature` bytes from one place.
// If a future SDK release changes either, both paths track the change
// automatically — no drift between what the buyer signed and what the
// verifier reconstructs.
//
// In `returnTypedDataToSign: true` mode the SDK:
//   - runs the same yup validation the signing path runs (good — same
//     check on both sides of the wire);
//   - calls `storeMetadataOnTheGraph` and `storeMetadataItems`, both of
//     which are no-ops when `metadataStorage` and `theGraphStorage`
//     are omitted;
//   - never invokes any method on the supplied `web3Lib`, which is
//     why a throwing-stub adapter is safe here.

import type { FullOfferArgs } from "@bosonprotocol/common";
import { metaTx } from "@bosonprotocol/core-sdk";
import type { Hex } from "viem";

import { createCalldataOnlyWeb3LibAdapter } from "../internal/web3lib-stub.js";
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

// Dummy values for `chainId` / `metaTxHandlerAddress` / `nonce` — the SDK
// requires them to build the meta-tx typed-data domain, but the
// `{ functionName, functionSignature }` pair we read back is independent
// of all three. Real values are unnecessary because we discard the
// typed-data portion.
const DUMMY_CHAIN_ID = 1;
const DUMMY_METATX_HANDLER_ADDRESS = "0x0000000000000000000000000000000000000000";
const DUMMY_NONCE = "0";

const STUB_CALLER_TAG = "@bosonprotocol/x402-evm:create-offer-and-commit";

/**
 * Build the `{ functionName, functionSignature }` calldata pair for the
 * `createOfferAndCommit` inner action by delegating to core-sdk. The
 * result feeds `@bosonprotocol/x402-core/eip712`'s
 * `metaTransactionTypedData` builder to produce the EIP-712 typed-data
 * the buyer signs.
 */
export async function buildCreateOfferAndCommitCalldata(
  args: BuildCreateOfferAndCommitCalldataArgs,
): Promise<InnerActionCalldata> {
  const result = await metaTx.handler.signMetaTxCreateOfferAndCommit({
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

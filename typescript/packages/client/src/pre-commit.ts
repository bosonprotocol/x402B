// Sign the Boson protocol meta-transaction for `createOfferAndCommit`.
//
// Routes through `CoreSDK.signMetaTxCreateOfferAndCommit` directly so the
// EIP-712 domain, function signature, and calldata encoding stay in
// lock-step with the deployed protocol. The returned `SignedMetaTx` is
// shaped exactly as the on-chain `MetaTransactionsHandlerFacet` recovers
// against; we re-shape it into the escrow scheme's wire-format
// `BosonMetaTx` for the X-PAYMENT payload.

import { randomBytes } from "node:crypto";

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type { FullOfferArgs } from "@bosonprotocol/common";
import type {
  BosonMetaTx,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address, Hex } from "viem";

export interface SignCreateOfferAndCommitMetaTxArgs {
  requirements: EscrowPaymentRequirements;
  coreSdk: CoreSDK;
  buyer: Address;
}

/**
 * Builds the buyer-side meta-tx for `createOfferAndCommit`, signs it via
 * `CoreSDK`, and returns the wire-format envelope ready to be embedded in
 * an `EscrowPaymentPayload`.
 *
 * The `createOfferAndCommitArgs` are reconstructed from the
 * `requirements.offer` triple — the opaque `fullOffer` carries the
 * `Omit<FullOfferArgs, "signature">` shape, `sellerSig` becomes the
 * `signature`, and the buyer's address is spliced in as `committer`. Any
 * shape drift between the wire format and `FullOfferArgs` surfaces as a
 * yup validation error from core-sdk's
 * `createOfferAndCommitArgsSchema.validateSync` — propagate it rather than
 * patch silently (CLAUDE.md "Production over spec when they diverge").
 */
export async function signCreateOfferAndCommitMetaTx({
  requirements,
  coreSdk,
  buyer,
}: SignCreateOfferAndCommitMetaTxArgs): Promise<BosonMetaTx> {
  const nonce = randomUint256();

  const createOfferAndCommitArgs = {
    ...(requirements.offer.fullOffer as object),
    signature: requirements.offer.sellerSig,
    committer: buyer,
  } as unknown as FullOfferArgs;

  const signed = await coreSdk.signMetaTxCreateOfferAndCommit({
    nonce: nonce.toString(),
    createOfferAndCommitArgs,
  });

  return {
    from: buyer,
    nonce: nonce.toString(),
    functionName: signed.functionName,
    functionSignature: signed.functionSignature as Hex,
    sig: {
      v: Number(signed.v),
      r: signed.r as Hex,
      s: signed.s as Hex,
    },
  };
}

function randomUint256(): bigint {
  const bytes = randomBytes(32);
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }
  return n;
}

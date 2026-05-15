// Sign the buyer's Boson protocol meta-transaction for one of the two
// commit-time actions:
//
//   - Flow A — `boson-createOfferAndCommit` (deferred redeem). Signed via
//     `coreSdk.signMetaTxCreateOfferAndCommit`.
//   - Flow B — `boson-createOfferCommitAndRedeem` (atomic commit+redeem
//     via `OrchestrationHandlerFacet2.createOfferCommitAndRedeem`). Signed
//     via `coreSdk.signMetaTxCreateOfferCommitAndRedeem`.
//
// Both route through `CoreSDK` directly so the EIP-712 domain, function
// signature, and calldata encoding stay in lock-step with the deployed
// protocol. The returned `SignedMetaTx` is shaped exactly as the on-chain
// `MetaTransactionsHandlerFacet` recovers against; we re-shape it into
// the escrow scheme's wire-format `BosonMetaTx` for the X-PAYMENT payload.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type { FullOfferArgs } from "@bosonprotocol/common";
import type {
  BosonMetaTx,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address, Hex } from "viem";

import { randomUint256 } from "./utils/crypto.js";

export interface SignCreateOfferAndCommitArgs {
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
export async function signCreateOfferAndCommit({
  requirements,
  coreSdk,
  buyer,
}: SignCreateOfferAndCommitArgs): Promise<BosonMetaTx> {
  const nonce = randomUint256();

  const createOfferAndCommitArgs = buildCreateOfferAndCommitArgs(requirements, buyer);

  const signed = await coreSdk.signMetaTxCreateOfferAndCommit({
    nonce: nonce.toString(),
    createOfferAndCommitArgs,
  });

  return reshape(signed, buyer, nonce);
}

/**
 * Flow B counterpart to {@link signCreateOfferAndCommit} — signs
 * the meta-tx that drives `OrchestrationHandlerFacet2.createOfferCommitAndRedeem`.
 * The argument shape is identical (the protocol uses the same
 * `FullOfferArgs` struct); only the resulting function selector and
 * post-state differ.
 */
export async function signCreateOfferCommitAndRedeem({
  requirements,
  coreSdk,
  buyer,
}: SignCreateOfferAndCommitArgs): Promise<BosonMetaTx> {
  const nonce = randomUint256();

  const createOfferAndCommitArgs = buildCreateOfferAndCommitArgs(requirements, buyer);

  const signed = await coreSdk.signMetaTxCreateOfferCommitAndRedeem({
    nonce: nonce.toString(),
    createOfferAndCommitArgs,
  });

  return reshape(signed, buyer, nonce);
}

function buildCreateOfferAndCommitArgs(
  requirements: EscrowPaymentRequirements,
  buyer: Address,
): FullOfferArgs {
  return {
    ...(requirements.offer.fullOffer as object),
    signature: requirements.offer.sellerSig,
    committer: buyer,
  } as unknown as FullOfferArgs;
}

function reshape(
  signed: {
    functionName: string;
    functionSignature: string;
    r: string;
    s: string;
    v: number;
  },
  buyer: Address,
  nonce: bigint,
): BosonMetaTx {
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

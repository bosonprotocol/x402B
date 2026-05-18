// `SellerActor` — the seller-side persona for scenario tests.
//
// Wraps a viem `LocalAccount` and offers the operations a seller
// performs in the x402B flows the e2e suite covers:
//
//   - `signOffer(unsigned)` — sign a `FullOffer` and produce the
//     `BosonOfferRef` the resource server embeds in
//     `PaymentRequirements`. Delegates to
//     `@bosonprotocol/x402-server`'s `signFullOffer`, which routes
//     through `@bosonprotocol/core-sdk` so the EIP-712 domain stays in
//     lock-step with the deployed protocol.
//
// Future PRs (when scenarios exercise them) extend this with
// `revokeVoucher`, `decideDisputeSig`, etc.
//
// The seller's `entityId` (the `sellerId` field on the `FullOffer`) is
// **not** owned by this actor — it's a property of the on-chain seller
// entity associated with the wallet, created at suite-seed time. See
// `./seed.ts`.

import { signFullOffer, type SellerSigner } from "@bosonprotocol/x402-server";
import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type { Address, BosonOfferRef } from "@bosonprotocol/x402-core/schemes/escrow";
import type { LocalAccount } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

export interface SellerActorArgs {
  /** Seller's signing key. Defaults to `ROLE_ACCOUNTS.seller` in callers. */
  account: LocalAccount;
  /** Boson Diamond — EIP-712 `verifyingContract` for the FullOffer signature. */
  escrow?: Address;
  /** Chain id baked into the EIP-712 salt. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
}

export interface SellerActor {
  readonly address: Address;
  readonly account: LocalAccount;
  /** SellerSigner shape consumed by `X402bServerConfig.signer` if a host wants the same key. */
  readonly signer: SellerSigner;
  /** Sign an unsigned FullOffer; returns a `BosonOfferRef` ready for `PaymentRequirements`. */
  signOffer: (unsigned: UnsignedFullOffer) => Promise<BosonOfferRef>;
}

export function createSellerActor(args: SellerActorArgs): SellerActor {
  const escrow = args.escrow ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;

  const signer: SellerSigner = {
    address: args.account.address,
    signTypedData: (params) =>
      args.account.signTypedData(params as Parameters<LocalAccount["signTypedData"]>[0]),
  };

  return {
    address: args.account.address,
    account: args.account,
    signer,
    signOffer: (unsigned) => signFullOffer({ fullOffer: unsigned, signer, escrow, chainId }),
  };
}

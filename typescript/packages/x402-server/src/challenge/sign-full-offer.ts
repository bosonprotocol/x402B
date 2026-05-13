// FullOffer signer hook — produces the seller's `BosonOfferRef` from
// an unsigned FullOffer. Delegates directly to
// `@bosonprotocol/core-sdk`'s `exchanges.handler.signFullOffer`,
// supplying a forwarding `Web3LibAdapter` that routes the inner
// `eth_signTypedData_v4` RPC call to the configured `SellerSigner`.
//
// Routing through core-sdk keeps the typed-data shape, EIP-712 domain
// (salt-based `Boson Protocol` / `V2`), and offer-struct
// canonicalisation in lock-step with the deployed protocol — we don't
// re-derive the FullOffer EIP-712 type-list on our side.

import { exchanges } from "@bosonprotocol/core-sdk";
import type { Web3LibAdapter } from "@bosonprotocol/common";
import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type {
  Address,
  BosonOfferRef,
  FullOffer,
  Hex,
} from "@bosonprotocol/x402-core/schemes/escrow";

import type { SellerSigner } from "../config.js";

const STUB_CALLER_TAG = "@bosonprotocol/x402-server:sign-full-offer";

export interface SignFullOfferArgs {
  fullOffer: UnsignedFullOffer;
  signer: SellerSigner;
  /** Boson Diamond address — the EIP-712 `verifyingContract`. */
  escrow: Address;
  chainId: number;
}

/**
 * Sign a FullOffer via `@bosonprotocol/core-sdk`'s `signFullOffer`
 * and return a `BosonOfferRef` ready to embed in
 * `EscrowPaymentRequirements.offer`. The seller signer is plugged
 * into core-sdk via a forwarding `Web3LibAdapter` so any viem
 * `LocalAccount` / HSM / KMS signer drops in without exposing
 * core-sdk's adapter shape in this package's public API.
 *
 * ERC-1271 contract-wallet sellers: pass the wallet's address as
 * `signer.address` and route `signer.signTypedData` to whatever
 * surface the wallet exposes — the protocol's on-chain `verifyOffer`
 * runs via `EIP712Lib.verify` which already handles both ECDSA and
 * ERC-1271 recovery.
 */
export async function signFullOffer({
  fullOffer,
  signer,
  escrow,
  chainId,
}: SignFullOfferArgs): Promise<BosonOfferRef> {
  const web3Lib = buildForwardingAdapter(signer, chainId);
  const result = await exchanges.handler.signFullOffer({
    fullOfferArgsUnsigned: fullOffer as unknown as Parameters<
      typeof exchanges.handler.signFullOffer
    >[0]["fullOfferArgsUnsigned"],
    contractAddress: escrow,
    chainId,
    web3Lib,
  });
  return {
    fullOffer: fullOffer as unknown as FullOffer,
    sellerSig: result.signature as Hex,
    creator: signer.address,
  };
}

/**
 * Build a `Web3LibAdapter` whose `send("eth_signTypedData_v4", [from, json])`
 * routes to `signer.signTypedData(...)`. core-sdk's `signFullOffer`
 * path only touches `getSignerAddress`, `getChainId`, and that one
 * `send` invocation — every other adapter method rejects so a future
 * leak into a non-signing-only path is loud rather than silent.
 */
function buildForwardingAdapter(signer: SellerSigner, chainId: number): Web3LibAdapter {
  const unreachable = (method: string): Promise<never> =>
    Promise.reject(
      new Error(
        `${STUB_CALLER_TAG}: Web3LibAdapter.${method}() called unexpectedly — sign-full-offer is a signing-only path.`,
      ),
    );

  return {
    uuid: `${STUB_CALLER_TAG}:forward`,
    getSignerAddress: () => Promise.resolve(signer.address),
    isSignerContract: () => Promise.resolve(false),
    getChainId: () => Promise.resolve(chainId),
    send: async (method, params) => {
      if (method !== "eth_signTypedData_v4") {
        throw new Error(`${STUB_CALLER_TAG}: unexpected RPC method: ${method}`);
      }
      const [, json] = params as [unknown, string];
      if (typeof json !== "string") {
        throw new Error(`${STUB_CALLER_TAG}: eth_signTypedData_v4 payload is not a JSON string`);
      }
      const td = JSON.parse(json) as {
        domain: Record<string, unknown>;
        types: Record<string, readonly { name: string; type: string }[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      return signer.signTypedData({
        domain: td.domain,
        types: td.types,
        primaryType: td.primaryType,
        message: td.message,
      });
    },
    getBalance: () => unreachable("getBalance"),
    estimateGas: () => unreachable("estimateGas"),
    sendTransaction: () => unreachable("sendTransaction"),
    call: () => unreachable("call"),
    getTransactionReceipt: () => unreachable("getTransactionReceipt"),
    getCurrentTimeMs: () => unreachable("getCurrentTimeMs"),
  };
}

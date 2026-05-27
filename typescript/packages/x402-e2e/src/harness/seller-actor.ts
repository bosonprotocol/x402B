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
//   - `signResolutionProposal({ exchangeId, buyerPercentBasisPoints })` —
//     sign the `Resolution(uint256 exchangeId, uint256 buyerPercentBasisPoints)`
//     proposal the buyer needs as `counterpartySig` when calling
//     `client.signAction({ actionId: "boson-resolveDispute", … })`.
//     Routes through `coreSdk.signDisputeResolutionProposal` so the
//     EIP-712 domain + type-list stay in lock-step with the deployed
//     protocol (per CLAUDE.md "reuse > re-implementation").
//
// The seller's `entityId` (the `sellerId` field on the `FullOffer`) is
// **not** owned by this actor — it's a property of the on-chain seller
// entity associated with the wallet, created at suite-seed time. See
// `./seed.ts`.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import { signFullOffer, type SellerSigner } from "@bosonprotocol/x402-server";
import type { UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type { Address, BosonOfferRef } from "@bosonprotocol/x402-core/schemes/escrow";
import type { Hex, LocalAccount, TypedDataDomain, TypedDataParameter } from "viem";

// Minimal duck-typed `Web3LibAdapter` shape — core-sdk's exported type
// lives in `@bosonprotocol/common`, but pulling that in as a direct
// dependency would balloon the harness's footprint just for one
// interface. The constructor only inspects the methods at runtime, so
// a structural type here is enough.
interface MinimalWeb3LibAdapter {
  uuid: string;
  getSignerAddress: () => Promise<string>;
  isSignerContract: () => Promise<boolean>;
  getChainId: () => Promise<number>;
  send: (method: string, params: unknown[]) => Promise<string>;
  call: (req: { to: string; data?: string }) => Promise<string>;
  getBalance: (...args: unknown[]) => Promise<unknown>;
  estimateGas: (...args: unknown[]) => Promise<unknown>;
  sendTransaction: (...args: unknown[]) => Promise<unknown>;
  getTransactionReceipt: (...args: unknown[]) => Promise<unknown>;
  getCurrentTimeMs: () => Promise<number>;
}

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

// Sentinel used when constructing the seller-side CoreSDK for
// resolution-proposal signing — the proposal path never touches the
// subgraph but `CoreSDK`'s constructor still requires a string.
const PLACEHOLDER_SUBGRAPH_URL = "https://x402-e2e.placeholder.invalid/subgraph";

export interface SellerActorArgs {
  /** Seller's signing key. Defaults to `ROLE_ACCOUNTS.seller` in callers. */
  account: LocalAccount;
  /** Escrow address — EIP-712 `verifyingContract` for the FullOffer signature (matches `onchainHints.escrow`). */
  escrow?: Address;
  /** Chain id baked into the EIP-712 salt. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
}

/** Args to `SellerActor.signResolutionProposal`. */
export interface SignResolutionProposalArgs {
  /** Disputed exchange id (decimal string or bigint). */
  exchangeId: bigint | string;
  /** Buyer share of the resolution in basis points (`10000` = 100 %). */
  buyerPercentBasisPoints: bigint | string;
}

/**
 * Signed resolution proposal — split into `{ r, s, v }` and the
 * concatenated `signature` hex. Either form satisfies the buyer's
 * `counterpartySig: Hex | { r, s, v }` parameter on
 * `client.signAction({ actionId: "boson-resolveDispute", … })`.
 */
export interface SignedResolutionProposal {
  r: Hex;
  s: Hex;
  v: number;
  /** 65-byte concatenated signature, `0x`-prefixed. */
  signature: Hex;
}

export interface SellerActor {
  readonly address: Address;
  readonly account: LocalAccount;
  /** SellerSigner shape consumed by `X402bServerConfig.signer` if a host wants the same key. */
  readonly signer: SellerSigner;
  /** Sign an unsigned FullOffer; returns a `BosonOfferRef` ready for `PaymentRequirements`. */
  signOffer: (unsigned: UnsignedFullOffer) => Promise<BosonOfferRef>;
  /**
   * Sign the `Resolution` EIP-712 message the buyer must aggregate as
   * `counterpartySig` to call `boson-resolveDispute`. Mirrors the
   * `signFullOffer` pattern — instantiates a one-shot `CoreSDK` with a
   * forwarding `Web3LibAdapter` so the typed-data shape stays in
   * lock-step with the deployed protocol.
   */
  signResolutionProposal: (args: SignResolutionProposalArgs) => Promise<SignedResolutionProposal>;
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

    async signResolutionProposal({ exchangeId, buyerPercentBasisPoints }) {
      const web3Lib = buildSellerForwardingAdapter(args.account, chainId);
      const sdk = new CoreSDK({
        // Cast through `never` — the adapter's tx-flavour methods are
        // typed to reject, but core-sdk's `Web3LibAdapter` requires
        // concrete `BigNumberish`/`TransactionResponse` returns. Those
        // paths are unreachable here (the proposal signer only invokes
        // `send("eth_signTypedData_v4", …)`), so the strict shape just
        // forces a no-op cast.
        web3Lib: web3Lib as never,
        subgraphUrl: PLACEHOLDER_SUBGRAPH_URL,
        protocolDiamond: escrow,
        chainId,
      });
      // `returnTypedDataToSign` defaults to `false` here so core-sdk
      // builds the typed data internally, routes it through
      // `web3Lib.send("eth_signTypedData_v4", …)` (→ seller account),
      // and returns `{ r, s, v, signature }`. The seller never has to
      // know the `Resolution` type-list — core-sdk owns it.
      const signed = await sdk.signDisputeResolutionProposal({
        exchangeId: typeof exchangeId === "bigint" ? exchangeId.toString() : exchangeId,
        buyerPercentBasisPoints:
          typeof buyerPercentBasisPoints === "bigint"
            ? buyerPercentBasisPoints.toString()
            : buyerPercentBasisPoints,
      });
      return {
        r: signed.r as Hex,
        s: signed.s as Hex,
        v: Number(signed.v),
        signature: signed.signature as Hex,
      };
    },
  };
}

/**
 * Forwarding `Web3LibAdapter` that routes core-sdk's
 * `eth_signTypedData_v4` RPC straight to the seller's viem
 * `LocalAccount`. Every other adapter method rejects — the seller
 * never goes on-chain through this path, so any leak into a tx-flavour
 * method should fail loudly rather than silently.
 */
function buildSellerForwardingAdapter(
  account: LocalAccount,
  chainId: number,
): MinimalWeb3LibAdapter {
  const unreachable = (method: string): Promise<never> =>
    Promise.reject(
      new Error(
        `[x402-e2e/seller-actor] stub Web3LibAdapter.${method}() is not implemented — the seller-side proposal signer is read-only`,
      ),
    );
  return {
    uuid: "x402-e2e:seller-resolution-adapter",
    getSignerAddress: async () => account.address,
    isSignerContract: async () => false,
    getChainId: async () => chainId,
    send: async (method, params) => {
      if (method !== "eth_signTypedData_v4") {
        throw new Error(
          `[x402-e2e/seller-actor] seller adapter does not support RPC method '${method}'; only eth_signTypedData_v4 is implemented`,
        );
      }
      const raw = (params as unknown[])[1];
      if (typeof raw !== "string") {
        throw new Error(
          "[x402-e2e/seller-actor] eth_signTypedData_v4 payload[1] is not a JSON string — core-sdk internals may have changed",
        );
      }
      const td = JSON.parse(raw) as {
        domain: TypedDataDomain;
        types: Record<string, readonly TypedDataParameter[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      // viem rejects an explicit `EIP712Domain` entry in `types` — it
      // derives the domain layout from the `domain` object itself.
      const { EIP712Domain: _drop, ...messageTypes } = td.types;
      // `signTypedData`'s overload set is strictly typed against
      // ahead-of-time `types`; we're routing a runtime-shaped payload
      // so a single `as never` lets viem's generic overload pick the
      // permissive path.
      return account.signTypedData({
        domain: td.domain,
        types: messageTypes,
        primaryType: td.primaryType,
        message: td.message,
      } as never);
    },
    call: () => unreachable("call"),
    getBalance: () => unreachable("getBalance"),
    estimateGas: () => unreachable("estimateGas"),
    sendTransaction: () => unreachable("sendTransaction"),
    getTransactionReceipt: () => unreachable("getTransactionReceipt"),
    getCurrentTimeMs: () => unreachable("getCurrentTimeMs"),
  };
}

// EIP-712 typed-data builder for the Boson Protocol meta-transaction envelope.
//
// The MetaTransaction struct shape and the salt-flavor EIP-712 domain are
// fully owned by `@bosonprotocol/core-sdk`'s
// `metaTx.handler.signMetaTx`. Rather than re-declaring them here (and risking
// drift), we route the signing call through a stub `Web3LibAdapter` that
// intercepts `eth_signTypedData_v4` to capture the structured data, then
// returns a dummy 65-byte signature so signMetaTx can finish without errors.
// The intercept adapter is built by the shared
// `createTypedDataInterceptAdapter` factory from `internal/web3lib-stub.ts`,
// so the same loud-error semantics apply to any future helper that needs
// to extract typed-data out of core-sdk.
//
// The captured object is exactly what the deployed protocol's
// `MetaTransactionsHandlerFacet` recovers signatures against.
//
// The same typed-data is consumed by both:
//
//   1. `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` — the
//      existing Boson entrypoint, already supported by `@bosonprotocol/core-sdk`.
//      Used when no token-transfer authorization payloads need to be queued
//      (e.g. `tokenAuthStrategy: "none"` flows where the buyer has
//      pre-approved the escrow contract).
//
//   2. `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization(...)`
//      — the BPIP-12 entrypoint. Used when ERC-3009 / EIP-2612 / Permit2
//      payloads are queued alongside the meta-tx.
//
// The buyer signs once. Choice of on-chain entrypoint is the relayer's, and
// happens at calldata-build time downstream (in `@bosonprotocol/x402-evm`).

import { metaTx } from "@bosonprotocol/core-sdk";
import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

import { createTypedDataInterceptAdapter } from "../internal/web3lib-stub.js";
import type { TypedDataField } from "./full-offer.js";

export const META_TRANSACTION_PRIMARY_TYPE = "MetaTransaction" as const;

/** Strongly-typed message body — what the buyer signs. */
export interface MetaTransactionMessage {
  /** `MetaTransactionsHandlerFacet.usedNonce[from][nonce]` replay-protection slot. */
  nonce: bigint;
  /** Buyer EOA. Must match the signature recovery on-chain. */
  from: Address;
  /** Address of the Boson escrow contract the call targets. */
  contractAddress: Address;
  /**
   * Solidity function-name+selector string, e.g.
   * `"createOfferCommitAndRedeem(BosonTypes.FullOffer,address,bytes,uint256)"`.
   */
  functionName: string;
  /** ABI-encoded function-call data. */
  functionSignature: Hex;
}

export interface MetaTransactionTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly TypedDataField[]>;
  primaryType: typeof META_TRANSACTION_PRIMARY_TYPE;
  message: Record<string, unknown>;
}

export interface MetaTransactionArgs {
  chainId: number;
  /** Address of the Boson escrow contract — the EIP-712 verifyingContract. */
  verifyingContract: Address;
  message: MetaTransactionMessage;
}

const STUB_CALLER_TAG = "@bosonprotocol/x402-core:meta-transaction";

/**
 * Build the EIP-712 typed-data for a Boson meta-transaction.
 *
 * Pass the result to:
 *   - `account.signTypedData(typedData)` (a viem `LocalAccount` / HD account);
 *   - `walletClient.signTypedData({ account, ...typedData })` (a viem
 *     `WalletClient` for browser-wallet / RPC signers).
 *
 * Use {@link recoverMetaTransactionSigner} to verify a signature.
 */
export async function metaTransactionTypedData({
  message,
  chainId,
  verifyingContract,
}: MetaTransactionArgs): Promise<MetaTransactionTypedData> {
  const intercept = createTypedDataInterceptAdapter<MetaTransactionTypedData>({
    callerTag: STUB_CALLER_TAG,
    // signMetaTx puts the signer's address into the `from` field of the
    // typed-data message — we want it to match the caller-supplied `from`.
    signerAddress: message.from,
    chainId,
    parse: (json) => JSON.parse(json) as MetaTransactionTypedData,
  });

  await metaTx.handler.signMetaTx({
    web3Lib: intercept.adapter,
    nonce: message.nonce.toString(),
    metaTxHandlerAddress: verifyingContract,
    chainId,
    functionName: message.functionName,
    functionSignature: message.functionSignature,
  });

  const captured = intercept.read();
  if (!captured) {
    throw new Error(
      "@bosonprotocol/x402-core:meta-transaction: signMetaTx did not invoke eth_signTypedData_v4 — " +
        "core-sdk internals may have changed",
    );
  }
  return captured;
}

/** EIP-712 digest for the meta-tx — what gets signed. */
export async function hashMetaTransaction(args: MetaTransactionArgs): Promise<Hex> {
  const td = await metaTransactionTypedData(args);
  return hashTypedData(td as Parameters<typeof hashTypedData>[0]);
}

/** Recover the signer address from a meta-tx signature. */
export async function recoverMetaTransactionSigner(
  args: MetaTransactionArgs & { signature: Hex },
): Promise<Address> {
  const { signature, ...rest } = args;
  const td = await metaTransactionTypedData(rest);
  return recoverTypedDataAddress({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
    signature,
  } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
}

// ===========================================================================
// Action-specific MetaTx variants.
//
// core-sdk's `metaTx.handler.signMetaTx*` methods use different EIP-712
// primary types for different action families. The recovery side MUST
// reconstruct the same typed-data structure or `ecrecover` yields a
// garbage address. The basic `MetaTransaction` type (handled by
// `metaTransactionTypedData` above) only covers the commit-time actions
// and `revokeVoucher`; the three builders below cover the rest. Each
// routes through the corresponding core-sdk `signMetaTx*({…,
// returnTypedDataToSign: true})` so the typed-data shape stays in
// lock-step with the deployed protocol — no manual re-derivation of
// types, domain, or message structure on our side.
// ===========================================================================

/** Loose typed-data shape — covers the action-specific variants below. */
export interface ActionMetaTransactionTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly TypedDataField[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

interface BaseActionArgs {
  chainId: number;
  /** Address of the Boson escrow contract — the EIP-712 verifyingContract. */
  verifyingContract: Address;
  /** Boson `MetaTransactionsHandlerFacet.usedNonce[from][nonce]` replay-protection slot. */
  nonce: bigint;
  /** Buyer / signer EOA — populates the typed-data `message.from`. */
  from: Address;
}

/**
 * Build the EIP-712 typed-data for an EXCHANGE-keyed post-commit meta-tx
 * (`redeemVoucher`, `cancelVoucher`, `completeExchange`,
 * `raiseDispute`, `retractDispute`, `escalateDispute`). All six share
 * the `MetaTxExchange` primary type and `exchangeDetails: {exchangeId}`
 * sub-struct; the only difference between them is `message.functionName`.
 */
export async function metaTransactionExchangeTypedData(
  args: BaseActionArgs & {
    /** Boson function signature, e.g. `"redeemVoucher(uint256)"`. */
    functionName: string;
    /** Exchange the action targets. */
    exchangeId: bigint;
  },
): Promise<ActionMetaTransactionTypedData> {
  return callCoreSdkForTypedData(args.from, args.chainId, async (web3Lib) =>
    metaTx.handler.signMetaTxRedeemVoucher({
      web3Lib,
      nonce: args.nonce.toString(),
      metaTxHandlerAddress: args.verifyingContract,
      chainId: args.chainId,
      exchangeId: args.exchangeId.toString(),
      returnTypedDataToSign: true,
    }),
  ).then((td) => withOverriddenFunctionName(td, args.functionName));
}

/**
 * Build the EIP-712 typed-data for `resolveDispute` — `MetaTxDisputeResolution`
 * primary type with a nested `disputeResolutionDetails` struct carrying
 * the exchange id, the buyer's percent split, and the counterparty's
 * signature.
 */
export async function metaTransactionDisputeResolutionTypedData(
  args: BaseActionArgs & {
    exchangeId: bigint;
    buyerPercentBasisPoints: bigint;
    /** Counterparty's signature over the resolution proposal — packed `r||s||v` hex. */
    counterpartySig: Hex;
  },
): Promise<ActionMetaTransactionTypedData> {
  return callCoreSdkForTypedData(args.from, args.chainId, async (web3Lib) =>
    metaTx.handler.signMetaTxResolveDispute({
      web3Lib,
      nonce: args.nonce.toString(),
      metaTxHandlerAddress: args.verifyingContract,
      chainId: args.chainId,
      exchangeId: args.exchangeId.toString(),
      buyerPercent: args.buyerPercentBasisPoints.toString(),
      counterpartySig: args.counterpartySig,
      returnTypedDataToSign: true,
    }),
  );
}

/**
 * Build the EIP-712 typed-data for `withdrawFunds` — `MetaTxFund` primary
 * type with a nested `fundDetails` struct carrying the entity id, the
 * token-address list, and the per-token amounts.
 */
export async function metaTransactionFundTypedData(
  args: BaseActionArgs & {
    entityId: bigint;
    tokenList: readonly Address[];
    tokenAmounts: readonly bigint[];
  },
): Promise<ActionMetaTransactionTypedData> {
  return callCoreSdkForTypedData(args.from, args.chainId, async (web3Lib) =>
    metaTx.handler.signMetaTxWithdrawFunds({
      web3Lib,
      nonce: args.nonce.toString(),
      metaTxHandlerAddress: args.verifyingContract,
      chainId: args.chainId,
      entityId: args.entityId.toString(),
      tokenList: args.tokenList as string[],
      tokenAmounts: args.tokenAmounts.map((amount) => amount.toString()),
      returnTypedDataToSign: true,
    }),
  );
}

/**
 * Drive a core-sdk `signMetaTx*({…, returnTypedDataToSign: true})` and
 * strip the convenience fields (`functionName`, `functionSignature`)
 * the SDK appends — only the EIP-712 typed-data shape is needed for
 * recovery.
 *
 * core-sdk's `returnTypedDataToSign: true` path short-circuits before
 * `eth_signTypedData_v4` is invoked, so we only need a `Web3LibAdapter`
 * that can answer `getSignerAddress()` and `getChainId()`. Any other
 * method invocation indicates core-sdk's internals changed and surfaces
 * loudly through {@link createTypedDataInterceptAdapter}'s stubs.
 */
async function callCoreSdkForTypedData(
  from: Address,
  chainId: number,
  invoke: (web3Lib: Parameters<typeof metaTx.handler.signMetaTx>[0]["web3Lib"]) => Promise<{
    domain: Record<string, unknown>;
    types: Record<string, readonly TypedDataField[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }>,
): Promise<ActionMetaTransactionTypedData> {
  const intercept = createTypedDataInterceptAdapter<ActionMetaTransactionTypedData>({
    callerTag: STUB_CALLER_TAG,
    signerAddress: from,
    chainId,
    // `parse` is wired up but never called — `returnTypedDataToSign: true`
    // short-circuits in core-sdk before `eth_signTypedData_v4` would fire.
    parse: (json) => JSON.parse(json) as ActionMetaTransactionTypedData,
  });
  const result = await invoke(intercept.adapter);
  return {
    domain: result.domain,
    types: result.types,
    primaryType: result.primaryType,
    message: result.message,
  };
}

/**
 * Substitute the typed-data's `message.functionName` for the action's
 * specific value. `metaTransactionExchangeTypedData` routes every
 * exchange-keyed action through `signMetaTxRedeemVoucher` (the six
 * methods produce identical types/domain/primaryType, differing only in
 * the hard-coded `functionName`); this override restores the correct
 * value so the recovered EIP-712 hash matches whatever the signer
 * actually signed.
 */
function withOverriddenFunctionName(
  td: ActionMetaTransactionTypedData,
  functionName: string,
): ActionMetaTransactionTypedData {
  return {
    ...td,
    message: { ...td.message, functionName },
  };
}

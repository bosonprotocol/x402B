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

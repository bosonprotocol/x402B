// Placeholder for `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization` —
// the BPIP-12 entrypoint that accepts a queue of token-transfer
// authorization payloads (ERC-3009 / EIP-2612 / Permit2) alongside the
// meta-tx ([docs/boson-impl-01-escrow-scheme.md §4.3]).
//
// `@bosonprotocol/core-sdk@1.46.1` does not yet ship this ABI nor a
// calldata helper for it. Once BPIP-12 lands in
// `IBosonMetaTransactionsHandlerABI`, swap the body to mirror
// `./execute-meta-transaction.ts` — same shape plus a `bytes[]
// tokenTransferAuthorizations` argument.

import { NotYetSupportedError } from "../errors.js";
import type { TxRequest } from "../types.js";
import type { BuildExecuteMetaTransactionArgs } from "./execute-meta-transaction.js";
import type { Hex } from "viem";

export interface BuildExecuteMetaTransactionWithTokenAuthArgs extends BuildExecuteMetaTransactionArgs {
  /** Queue of opaque BPIP-12 token-transfer authorization payloads. */
  tokenTransferAuthorizations: readonly Hex[];
}

/**
 * @throws NotYetSupportedError — BPIP-12's
 * `executeMetaTransactionWithTokenTransferAuthorization` entrypoint is not
 * yet present in `IBosonMetaTransactionsHandlerABI`. Tracked against BPIP-12.
 */
export function buildExecuteMetaTransactionWithTokenAuthTx(
  _args: BuildExecuteMetaTransactionWithTokenAuthArgs,
): TxRequest {
  throw new NotYetSupportedError(
    "buildExecuteMetaTransactionWithTokenAuthTx",
    "MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization is not yet shipped in @bosonprotocol/core-sdk (tracked against BPIP-12).",
  );
}

// Public surface for `@bosonprotocol/x402-evm/envelope`.
//
// `buildExecuteMetaTransactionTx` targets the Boson
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint —
// used for `tokenAuthStrategy: "none"` flows where the buyer has
// pre-approved the escrow contract.
//
// `buildExecuteMetaTransactionWithTokenAuthTx` targets the BPIP-12
// variant `executeMetaTransactionWithTokenTransferAuthorization(...)`,
// which accepts an ABI-encoded queue of token-transfer authorizations
// (ERC-3009 / EIP-2612 Permit / Permit2) alongside the meta-tx.

export type { TxRequest } from "../types.js";

export {
  buildExecuteMetaTransactionTx,
  type BuildExecuteMetaTransactionArgs,
} from "./execute-meta-transaction.js";

export {
  buildExecuteMetaTransactionWithTokenAuthTx,
  type BuildExecuteMetaTransactionWithTokenAuthArgs,
  type TransferAuthorization,
} from "./execute-meta-transaction-with-token-auth.js";

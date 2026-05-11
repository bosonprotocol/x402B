// Public surface for `@bosonprotocol/x402-evm/envelope`.
//
// `buildExecuteMetaTransactionTx` targets the existing Boson
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint —
// supported today for `tokenAuthStrategy: "none"` flows where the buyer
// has pre-approved the escrow contract.
//
// `buildExecuteMetaTransactionWithTokenAuthTx` is the BPIP-12 variant
// (deferred); shipped as a throwing stub.

export type { TxRequest } from "../types.js";
export { NotYetSupportedError } from "../errors.js";

export {
  buildExecuteMetaTransactionTx,
  type BuildExecuteMetaTransactionArgs,
} from "./execute-meta-transaction.js";

export {
  buildExecuteMetaTransactionWithTokenAuthTx,
  type BuildExecuteMetaTransactionWithTokenAuthArgs,
} from "./deferred-execute-with-token-auth.js";

// `settle` — submit the buyer's signed meta-tx to
// `MetaTransactionsHandlerFacet.executeMetaTransaction` on the Boson
// Diamond.
//
// In v0.1 (this scaffold) this is a stub that throws NotImplementedError.
//
// Future implementation funnels every escrow settle through the single
// on-chain entrypoint described in docs/boson-impl-07-facilitator.md
// §"Settle path":
//
//   MetaTransactionsHandlerFacet.executeMetaTransaction(
//     userAddress, functionName, functionSignature, nonce, packedSig
//   )
//
// The inner calldata (`payload.metaTx.functionName` and
// `payload.metaTx.functionSignature`) is passed straight through from the
// request — the facilitator does not re-build it; the buyer's CoreSDK
// signs both inner and outer on the client side.
//
// Outer envelope construction goes through
// `@bosonprotocol/x402-evm/envelope`'s `buildExecuteMetaTransactionTx`.
//
// On success returns `{ ok: true, exchangeId, txHash }` with `exchangeId`
// pulled from the receipt's `BuyerCommitted` event.
//
// The BPIP-12 `executeMetaTransactionWithTokenTransferAuthorization`
// path delegates to `buildExecuteMetaTransactionWithTokenAuthTx`, which
// currently throws `NotYetSupportedError`. We catch and map to
// `UNSUPPORTED_TOKEN_AUTH_STRATEGY` once implemented.

import { NotImplementedError } from "../errors.js";
import type {
  FacilitatorConfig,
  FacilitatorSettleInput,
  FacilitatorSettleResult,
} from "../types.js";

export async function settle(
  _input: FacilitatorSettleInput,
  _config: FacilitatorConfig,
): Promise<FacilitatorSettleResult> {
  throw new NotImplementedError("settle");
}

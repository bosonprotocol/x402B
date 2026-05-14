// `settle` — submit the buyer's signed meta-tx to the Boson Diamond.
//
// Pipeline:
//   1. Run `verify()` first — bail on any failure.
//   2. Build the outer envelope via @bosonprotocol/x402-evm, dispatching
//      on payload.tokenAuthStrategy. The `"none"` path uses
//      `executeMetaTransaction`; ERC-3009 / Permit / Permit2 use the
//      BPIP-12 `executeMetaTransactionWithTokenTransferAuthorization`
//      with the buyer's signed authorization lifted into a single-entry
//      queue.
//   3. Submit via the configured WalletClient (relayer pays gas).
//   4. Await the receipt; an on-chain revert surfaces as ONCHAIN_REVERT.
//   5. Parse `BuyerCommitted` from the receipt to extract `exchangeId`.
//
// All steps return discriminated-union results — no thrown errors leak
// to the caller unless the underlying transport itself fails (those map
// to INTERNAL_ERROR via toResult()).

import type {
  FacilitatorConfig,
  FacilitatorSettleInput,
  FacilitatorSettleResult,
} from "../types.js";
import { toResult } from "../errors.js";
import { verify } from "../verify/index.js";

import { buildSettleEnvelope } from "./build-envelope.js";
import { extractExchangeId } from "./extract-exchange-id.js";
import { submit } from "./submit.js";

export async function settle(
  input: FacilitatorSettleInput,
  config: FacilitatorConfig,
): Promise<FacilitatorSettleResult> {
  try {
    // 1. Verify first. The verify() result type doesn't carry a success
    //    payload, so we can re-emit failures as-is and proceed on ok.
    const v = await verify(input, config);
    if (!v.ok) return v;

    const inner = input.payload.payload;
    const escrowAddress = input.requirements.escrowAddress as `0x${string}`;

    // 2. Build outer envelope.
    const envelope = buildSettleEnvelope({
      escrowAddress,
      buyer: inner.buyer as `0x${string}`,
      metaTx: inner.metaTx,
      strategy: inner.tokenAuthStrategy,
      tokenAuth: inner.tokenAuth,
    });
    if (!envelope.ok) return envelope;

    // 3 + 4. Submit and wait for receipt.
    const submitted = await submit({
      tx: envelope.tx,
      walletClient: config.walletClient,
      publicClient: config.publicClient,
    });
    if (!submitted.ok) return submitted;

    // 5. Extract exchangeId from BuyerCommitted.
    const extracted = extractExchangeId(submitted.receipt);
    if (!extracted.ok) return extracted;

    return {
      ok: true,
      exchangeId: extracted.exchangeId,
      txHash: submitted.txHash,
    };
  } catch (e) {
    return toResult(e);
  }
}

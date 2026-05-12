// Build the outer meta-tx envelope `settle()` will broadcast.
//
// For `tokenAuthStrategy: "none"` we route through
// `@bosonprotocol/x402-evm/envelope`'s `buildExecuteMetaTransactionTx`,
// which encodes the existing
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint.
//
// For ERC-3009 / EIP-2612 Permit / Permit2 strategies we delegate to
// `buildExecuteMetaTransactionWithTokenAuthTx`, which currently throws
// `NotYetSupportedError` until BPIP-12 ships in `core-sdk`. We catch the
// throw and surface it to the caller as
// `UNSUPPORTED_TOKEN_AUTH_STRATEGY` so HTTP consumers get a structured
// 4xx instead of a 5xx.

import {
  NotYetSupportedError,
  buildExecuteMetaTransactionTx,
  buildExecuteMetaTransactionWithTokenAuthTx,
  type TxRequest,
} from "@bosonprotocol/x402-evm/envelope";
import type {
  Address,
  BosonMetaTx,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";

import type { FacilitatorErrorCode } from "../types.js";

export interface BuildSettleEnvelopeArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
  strategy: TokenAuthStrategy;
}

export type BuildSettleEnvelopeResult =
  | { ok: true; tx: TxRequest }
  | { ok: false; code: FacilitatorErrorCode; reason: string };

export function buildSettleEnvelope(args: BuildSettleEnvelopeArgs): BuildSettleEnvelopeResult {
  const common = {
    escrowAddress: args.escrowAddress as `0x${string}`,
    userAddress: args.buyer as `0x${string}`,
    functionName: args.metaTx.functionName,
    functionSignature: args.metaTx.functionSignature as `0x${string}`,
    nonce: BigInt(args.metaTx.nonce),
    sig: {
      r: args.metaTx.sig.r as `0x${string}`,
      s: args.metaTx.sig.s as `0x${string}`,
      v: args.metaTx.sig.v,
    },
  };

  if (args.strategy === "none") {
    return { ok: true, tx: buildExecuteMetaTransactionTx(common) };
  }

  try {
    const tx = buildExecuteMetaTransactionWithTokenAuthTx({
      ...common,
      // The actual byte layout of `tokenTransferAuthorizations[i]` is
      // gated on BPIP-12; for now pass an empty queue. When BPIP-12
      // lands the caller will encode the buyer's tokenAuth payload here.
      tokenTransferAuthorizations: [],
    });
    return { ok: true, tx };
  } catch (e) {
    if (e instanceof NotYetSupportedError) {
      return {
        ok: false,
        code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY",
        reason: `tokenAuthStrategy "${args.strategy}" is not yet supported by @bosonprotocol/x402-evm: ${e.message}`,
      };
    }
    throw e;
  }
}

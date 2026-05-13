// Build the outer meta-tx envelope `settle()` will broadcast.
//
// For `tokenAuthStrategy: "none"` we route through
// `@bosonprotocol/x402-evm/envelope`'s `buildExecuteMetaTransactionTx`,
// which encodes the existing
// `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint.
//
// ERC-3009 / EIP-2612 Permit / Permit2 strategies require the BPIP-12
// token-auth envelope. That encoder is not wired through here yet because
// it also needs the buyer's tokenAuth payload, so return a structured
// `UNSUPPORTED_TOKEN_AUTH_STRATEGY` instead of ever building incomplete
// calldata.

import {
  buildExecuteMetaTransactionTx,
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

  return {
    ok: false,
    code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY",
    reason: `tokenAuthStrategy "${args.strategy}" requires the BPIP-12 token-auth envelope, which is not yet wired in settle()`,
  };
}

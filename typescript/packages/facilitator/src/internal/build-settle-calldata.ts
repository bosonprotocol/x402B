// Build the outer-envelope calldata via `@bosonprotocol/core-sdk`'s
// `metaTx.handler` helpers in `returnTxInfo: true` mode.
//
// Used by the simulate (`eth_call`) pre-flight: we need just the
// `{ to, data }` pair to drive `publicClient.call(...)`, not a full
// `coreSdk.executeMetaTransaction(...)` submission. The handler
// helpers dispatch on whether `transferAuthorizations` is provided —
// the SDK's `executeMetaTransactionWithTokenTransferAuthorization`
// is the BPIP-12 variant that consumes a token-transfer-authorization
// queue alongside the meta-tx.

import type { BosonMetaTx } from "@bosonprotocol/x402-core/schemes/escrow";
import { metaTx } from "@bosonprotocol/core-sdk";
import { createCalldataOnlyWeb3LibAdapter } from "@bosonprotocol/x402-evm/adapters";

import type { TransferAuthorization } from "./token-auth-lift.js";

const STUB_TAG = "@bosonprotocol/x402-facilitator:build-settle-calldata";

export interface BuildSettleCalldataArgs {
  escrowAddress: string;
  userAddress: string;
  metaTx: BosonMetaTx;
  /** Omit or pass an empty array for the `tokenAuthStrategy: "none"` path. */
  transferAuthorizations?: readonly TransferAuthorization[];
}

export async function buildSettleCalldata(
  args: BuildSettleCalldataArgs,
): Promise<{ to: string; data: string }> {
  const web3Lib = createCalldataOnlyWeb3LibAdapter(STUB_TAG);
  const baseArgs = {
    contractAddress: args.escrowAddress,
    web3Lib,
    userAddress: args.userAddress,
    functionName: args.metaTx.functionName,
    functionSignature: args.metaTx.functionSignature,
    nonce: args.metaTx.nonce,
    sigR: args.metaTx.sig.r,
    sigS: args.metaTx.sig.s,
    sigV: args.metaTx.sig.v,
    returnTxInfo: true as const,
  };

  const tx =
    args.transferAuthorizations && args.transferAuthorizations.length > 0
      ? await metaTx.handler.executeMetaTransactionWithTokenTransferAuthorization({
          ...baseArgs,
          transferAuthorizations: [...args.transferAuthorizations],
        })
      : await metaTx.handler.executeMetaTransaction(baseArgs);

  if (tx.to === undefined || tx.data === undefined) {
    throw new Error(
      `${STUB_TAG}: core-sdk returned an envelope without to/data — core-sdk internals may have changed`,
    );
  }
  return { to: tx.to, data: tx.data };
}

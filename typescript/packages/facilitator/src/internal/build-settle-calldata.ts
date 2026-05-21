// Build the outer-envelope calldata for the simulate / settle paths.
//
// Two envelopes share this helper:
//   - `executeMetaTransaction(...)` — the `"none"` token-auth path. The
//     SDK's `metaTx.handler.executeMetaTransaction` returns a viem-
//     submittable `{ to, data }` pair in `returnTxInfo: true` mode, and
//     no queue is involved.
//   - `executeMetaTransactionWithTokenTransferAuthorization(...)` — the
//     BPIP-12 variant. We build this one via viem directly (see
//     `build-bpip12-calldata.ts`) because the SDK's
//     `erc20.handler.encodeTransferAuthorizationQueue` only encodes
//     strategy-typed entries and can't represent the empty-bytes
//     fallback slots the protocol expects ahead of the buyer's auth.

import type {
  BosonMetaTx,
  BosonTokenAuth,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { metaTx } from "@bosonprotocol/core-sdk";
import { createCalldataOnlyWeb3LibAdapter } from "@bosonprotocol/x402-evm/adapters";
import type { Hex } from "viem";

import { buildBpip12Calldata } from "./build-bpip12-calldata.js";
import { packRsv } from "../verify/meta-tx-signature.js";

const STUB_TAG = "@bosonprotocol/x402-facilitator:build-settle-calldata";

export interface BuildSettleCalldataArgs {
  /** Boson escrow (Diamond) address — accepts the schema's `Address` (`string`); cast to `0x${string}` inside. */
  escrowAddress: string;
  /** Buyer EOA from the payload. */
  userAddress: string;
  metaTx: BosonMetaTx;
  /** Action id from `payload.payload.action` — drives the BPIP-12 queue layout. */
  actionId: string;
  /** Strategy from `payload.payload.tokenAuthStrategy`. */
  tokenAuthStrategy: TokenAuthStrategy;
  /** Required when `tokenAuthStrategy !== "none"`. */
  tokenAuth?: BosonTokenAuth;
}

export async function buildSettleCalldata(
  args: BuildSettleCalldataArgs,
): Promise<{ to: `0x${string}`; data: Hex }> {
  if (args.tokenAuthStrategy !== "none") {
    if (!args.tokenAuth) {
      throw new Error(
        `${STUB_TAG}: tokenAuthStrategy "${args.tokenAuthStrategy}" requires args.tokenAuth`,
      );
    }
    return buildBpip12Calldata({
      escrowAddress: args.escrowAddress as `0x${string}`,
      userAddress: args.userAddress as `0x${string}`,
      functionName: args.metaTx.functionName,
      functionSignature: args.metaTx.functionSignature as Hex,
      nonce: BigInt(args.metaTx.nonce),
      signature: packRsv(
        args.metaTx.sig.r as Hex,
        args.metaTx.sig.s as Hex,
        args.metaTx.sig.v,
      ) as Hex,
      actionId: args.actionId,
      tokenAuth: args.tokenAuth,
    });
  }

  const web3Lib = createCalldataOnlyWeb3LibAdapter(STUB_TAG);
  const tx = await metaTx.handler.executeMetaTransaction({
    contractAddress: args.escrowAddress,
    web3Lib,
    userAddress: args.userAddress,
    functionName: args.metaTx.functionName,
    functionSignature: args.metaTx.functionSignature,
    nonce: args.metaTx.nonce,
    sigR: args.metaTx.sig.r,
    sigS: args.metaTx.sig.s,
    sigV: args.metaTx.sig.v,
    returnTxInfo: true,
  });

  if (tx.to === undefined || tx.data === undefined) {
    throw new Error(
      `${STUB_TAG}: core-sdk returned an envelope without to/data — core-sdk internals may have changed`,
    );
  }
  return { to: tx.to as `0x${string}`, data: tx.data as Hex };
}

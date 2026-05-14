// Build the outer meta-tx envelope `settle()` will broadcast.
//
// `tokenAuthStrategy: "none"` → `buildExecuteMetaTransactionTx` (existing
// `executeMetaTransaction` entrypoint). All other strategies →
// `buildExecuteMetaTransactionWithTokenAuthTx` (BPIP-12
// `executeMetaTransactionWithTokenTransferAuthorization`), with the buyer's
// wire-format `BosonTokenAuth` lifted into a single-entry
// `TransferAuthorization` queue.

import {
  buildExecuteMetaTransactionTx,
  buildExecuteMetaTransactionWithTokenAuthTx,
  type TransferAuthorization,
  type TxRequest,
} from "@bosonprotocol/x402-evm/envelope";
import type {
  Address,
  BosonMetaTx,
  BosonTokenAuth,
  TokenAuthStrategy,
} from "@bosonprotocol/x402-core/schemes/escrow";

import type { FacilitatorErrorCode } from "../types.js";

export interface BuildSettleEnvelopeArgs {
  escrowAddress: Address;
  buyer: Address;
  metaTx: BosonMetaTx;
  strategy: TokenAuthStrategy;
  /** Required when `strategy !== "none"`; ignored otherwise. */
  tokenAuth?: BosonTokenAuth;
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

  if (!args.tokenAuth) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      reason: `tokenAuthStrategy "${args.strategy}" requires payload.tokenAuth but none was provided`,
    };
  }

  const transferAuth = bosonTokenAuthToTransferAuthorization(args.tokenAuth);
  return {
    ok: true,
    tx: buildExecuteMetaTransactionWithTokenAuthTx({
      ...common,
      transferAuthorizations: [transferAuth],
    }),
  };
}

/**
 * Lift the buyer's wire-format `BosonTokenAuth` into the SDK's
 * `TransferAuthorization` shape that `encodeTransferAuthorizationQueue`
 * accepts. For ERC-3009 and EIP-2612 the on-chain encoder consumes `r/s/v`
 * directly; for Permit2 only `signature` is used by the encoder and
 * `r/s/v` are required only to satisfy the SDK's type — derive them from
 * the packed signature for completeness.
 */
function bosonTokenAuthToTransferAuthorization(tokenAuth: BosonTokenAuth): TransferAuthorization {
  switch (tokenAuth.kind) {
    case "erc3009":
      return {
        strategy: "ERC3009",
        data: {
          validAfter: tokenAuth.data.validAfter,
          validBefore: tokenAuth.data.validBefore,
          nonce: tokenAuth.data.nonce,
        },
        r: tokenAuth.data.r,
        s: tokenAuth.data.s,
        v: tokenAuth.data.v,
        signature: packSignature(tokenAuth.data.r, tokenAuth.data.s, tokenAuth.data.v),
      };
    case "permit":
      return {
        strategy: "EIP2612",
        data: { deadline: tokenAuth.data.deadline },
        r: tokenAuth.data.r,
        s: tokenAuth.data.s,
        v: tokenAuth.data.v,
        signature: packSignature(tokenAuth.data.r, tokenAuth.data.s, tokenAuth.data.v),
      };
    case "permit2": {
      const { r, s, v } = unpackSignature(tokenAuth.data.signature);
      return {
        strategy: "Permit2",
        data: { nonce: tokenAuth.data.nonce, deadline: tokenAuth.data.deadline },
        r,
        s,
        v,
        signature: tokenAuth.data.signature,
      };
    }
    default: {
      // Exhaustiveness guard: a new variant added to BosonTokenAuth without
      // a matching case here will break this `never` assignment at compile
      // time, forcing the new strategy to grow a mapper.
      const _exhaustive: never = tokenAuth;
      throw new Error(
        `facilitator/build-envelope: unrecognised tokenAuth.kind '${(_exhaustive as { kind: string }).kind}'`,
      );
    }
  }
}

function packSignature(r: string, s: string, v: number): string {
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${r.slice(2)}${s.slice(2)}${vHex}`;
}

function unpackSignature(sig: string): { r: string; s: string; v: number } {
  const hex = sig.startsWith("0x") ? sig.slice(2) : sig;
  if (hex.length !== 130) {
    throw new Error(
      `facilitator/build-envelope: Permit2 signature must be 65 bytes (130 hex chars), got ${hex.length / 2} bytes`,
    );
  }
  return {
    r: `0x${hex.slice(0, 64)}`,
    s: `0x${hex.slice(64, 128)}`,
    v: parseInt(hex.slice(128, 130), 16),
  };
}

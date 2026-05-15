// Lift the buyer's wire-format `BosonTokenAuth` into the SDK's
// `TransferAuthorization` shape that
// `coreSdk.executeMetaTransaction({ transferAuthorizations })` and the
// underlying `erc20.handler.encodeTransferAuthorizationQueue` accept.
//
// For ERC-3009 and EIP-2612 the on-chain encoder consumes `r/s/v`
// directly; for Permit2 only `signature` is used by the encoder and
// `r/s/v` are required only to satisfy the SDK's type — derive them
// from the packed signature for completeness.

import type { erc20 } from "@bosonprotocol/core-sdk";
import type { BosonTokenAuth } from "@bosonprotocol/x402-core/schemes/escrow";

/**
 * One entry of the BPIP-12 token-transfer authorization queue. Sourced
 * structurally from the SDK's
 * `erc20.handler.encodeTransferAuthorizationQueue` input so the type
 * tracks whatever the SDK's public namespace exposes — no hand-mirrored
 * union.
 */
export type TransferAuthorization = Parameters<
  typeof erc20.handler.encodeTransferAuthorizationQueue
>[0][number];

export function bosonTokenAuthToTransferAuthorization(
  tokenAuth: BosonTokenAuth,
): TransferAuthorization {
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
        `facilitator/token-auth-lift: unrecognised tokenAuth.kind '${(_exhaustive as { kind: string }).kind}'`,
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
      `facilitator/token-auth-lift: Permit2 signature must be 65 bytes (130 hex chars), got ${hex.length / 2} bytes`,
    );
  }
  return {
    r: `0x${hex.slice(0, 64)}`,
    s: `0x${hex.slice(64, 128)}`,
    v: parseInt(hex.slice(128, 130), 16),
  };
}

// ECDSA-signature packing/validation helpers shared between the two
// meta-tx envelope builders (`execute-meta-transaction.ts` and
// `execute-meta-transaction-with-token-auth.ts`).
//
// On-chain, both `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`
// and its BPIP-12 variant
// `executeMetaTransactionWithTokenTransferAuthorization(...)` consume the
// buyer's meta-tx signature as a 65-byte `r ++ s ++ v` blob that
// `LibSignature.recover` slices with fixed offsets. Malformed
// (shortened / non-hex / wrong-byte-length) inputs would silently
// produce revert-prone calldata — `packEcdsaSignature` enforces the
// canonical shape upfront so callers see a clear error before broadcast.
//
// Kept internal to the package: not re-exported from the public surface.

import { concat, type Hex } from "viem";

const WORD32_RE = /^0x[0-9a-fA-F]{64}$/;

function normalizeRecoveryId(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v;
}

function assert32ByteHex(value: Hex, field: "r" | "s"): void {
  if (!WORD32_RE.test(value)) {
    throw new Error(
      `@bosonprotocol/x402-evm: meta-tx signature ${field} must be a 32-byte hex value (0x-prefixed, 64 hex chars), got ${value}`,
    );
  }
}

/**
 * Pack a split ECDSA signature into the 65-byte `r ++ s ++ v` form the
 * contract's `LibSignature.recover` slices. `r` and `s` must each be
 * exactly a 32-byte hex word; `v` must be 27 or 28 (legacy form — the
 * on-chain recover doesn't normalise the 0/1 variant).
 */
export function packEcdsaSignature(sig: { r: Hex; s: Hex; v: number | bigint }): Hex {
  assert32ByteHex(sig.r, "r");
  assert32ByteHex(sig.s, "s");
  const v = normalizeRecoveryId(sig.v);
  if (v !== 27 && v !== 28) {
    throw new Error(`@bosonprotocol/x402-evm: meta-tx signature v must be 27 or 28, got ${sig.v}`);
  }
  const vHex = `0x${v.toString(16).padStart(2, "0")}` as Hex;
  return concat([sig.r, sig.s, vHex]);
}

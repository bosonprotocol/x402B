// Cross-platform random helpers.
//
// The client is framework-agnostic: it must run in browsers (where
// `node:crypto` is unavailable) as well as Node. The Web Crypto API
// (`globalThis.crypto.getRandomValues`) covers both — it's been a Node
// global since 19 and is universally available in modern browsers.
// The package's `engines.node` already requires Node ≥ 22, so we can
// rely on the global without a `node:crypto` fallback.
//
// Centralizing the helpers here keeps `pre-commit.ts`, `post-commit.ts`,
// and `token-auth/erc3009.ts` from each importing their own crypto
// primitive and re-deriving the same byte → bigint / byte → hex
// conversion (CLAUDE.md "Move duplicated constants ... into a shared
// file the moment they appear in two places").

import type { Hex } from "viem";

/** Fill a fresh `Uint8Array` of `size` bytes with cryptographically random bytes. */
export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error(
      "x402-client: globalThis.crypto.getRandomValues is unavailable — environment lacks the Web Crypto API",
    );
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 32-byte cryptographically random `0x`-prefixed hex string. */
export function randomBytes32(): Hex {
  const bytes = randomBytes(32);
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex as Hex;
}

/** Cryptographically random `uint256`. Used for protocol meta-tx replay-protection nonces. */
export function randomUint256(): bigint {
  const bytes = randomBytes(32);
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }
  return n;
}

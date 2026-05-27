// Shared assertion literals reused across the scenario test files.
// Centralised so a single change (e.g. switching the default scenario
// amount) doesn't need to be hunted across every scenario file.

/** Matches any `0x`-prefixed hex string — used to spot-check tx hashes. */
export const TX_HASH_REGEX = /^0x[0-9a-fA-F]+$/;

/**
 * Default scenario commit amount in atomic units (1 USDC at 6dp).
 * Mirrors the `_setup.ts` default and matches what the resource server
 * advertises in its 402 challenge.
 */
export const EXPECTED_PRICE = "1000000";

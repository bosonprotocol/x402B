// Shared input-shape regexes for the entity-keyed handlers
// (`handleWithdrawFunds`, `handleGetAvailableFunds`, the express
// adapter routes). Centralised here so the wire-level validation stays
// consistent across endpoints — drift between two copies is exactly
// the kind of bug that lets a malformed request slip through one
// route's check but trip a deeper layer with a less precise error.

/** Boson account `entityId` — a uint256 in decimal-string form. */
export const DECIMAL_UINT_RE = /^\d+$/;

/** 20-byte EVM address, 0x-prefixed, any letter case (we normalise downstream). */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Hex-string check for `signedPayload`. Requires `0x` followed by an
 * *even* number of hex digits so the body decodes to whole bytes —
 * odd-length payloads like `0xabc` would surface as
 * `signedPayload decode failed: …` deep in the facilitator pipeline,
 * which is a less precise 502 than the adapter-level 400 this regex
 * catches.
 */
export const HEX_BYTES_RE = /^0x([0-9a-fA-F]{2})*$/;

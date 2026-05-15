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

/** Hex-string check matching the `0x[0-9a-fA-F]*` shape `signedPayload` is typed as. */
export const HEX_BYTES_RE = /^0x[0-9a-fA-F]*$/;

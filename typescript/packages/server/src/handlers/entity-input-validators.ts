// Shared input-shape regexes for the entity-keyed handlers
// (`handleWithdrawFunds`, `handleGetAvailableFunds`, the express
// adapter routes). Centralised here so the wire-level validation stays
// consistent across endpoints — drift between two copies is exactly
// the kind of bug that lets a malformed request slip through one
// route's check but trip a deeper layer with a less precise error.
//
// `DECIMAL_UINT` and `ADDRESS` are sourced from `@bosonprotocol/x402-core`'s
// `schemes/escrow` validators (the JSON-Schema-aligned canonical
// definitions); re-exported under the local `_RE` alias to keep the
// existing call sites stable.

import { ADDRESS, DECIMAL_UINT } from "@bosonprotocol/x402-core/schemes/escrow";

/** Boson account `entityId` — uint256 in decimal-string form, no leading zeros. */
export const DECIMAL_UINT_RE = DECIMAL_UINT;

/** 20-byte EVM address, 0x-prefixed, any letter case (we normalise downstream). */
export const ADDRESS_RE = ADDRESS;

/**
 * Hex-string check for `signedPayload`. Requires `0x` followed by an
 * *even* number of hex digits so the body decodes to whole bytes —
 * odd-length payloads like `0xabc` would surface as
 * `signedPayload decode failed: …` deep in the facilitator pipeline,
 * which is a less precise 502 than the adapter-level 400 this regex
 * catches. Stricter than core's `HEX_BYTES` (which permits odd
 * lengths) so we keep this one local.
 */
export const HEX_BYTES_RE = /^0x([0-9a-fA-F]{2})*$/;

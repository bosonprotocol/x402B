// Shared regex patterns + scalar zod schemas used across the `escrow`
// scheme's payment-requirements and payment-payload validators. Keeping
// them in one place ensures the JSON Schema's patterns and the zod regexes
// stay in sync (see `schemas/*.json` for the JSON Schema source of truth).

import { z } from "zod";

/** 0x-prefixed hex string, at least one nibble. */
export const HEX = /^0x[a-fA-F0-9]+$/;

/** 0x-prefixed hex string, allowing the empty `0x` form for empty bytes. */
export const HEX_BYTES = /^0x[a-fA-F0-9]*$/;

/** 0x-prefixed 32-byte (64-nibble) hex string. */
export const HEX32 = /^0x[a-fA-F0-9]{64}$/;

/** 0x-prefixed 20-byte (40-nibble) hex address. */
export const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Decimal unsigned integer string, no leading zeros (except "0" itself). */
export const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/;

/** CAIP-2 EVM network identifier: `eip155:<chainId>`. */
export const EVM_NETWORK = /^eip155:[1-9][0-9]*$/;

export const addressSchema = z.string().regex(ADDRESS);
export const hexSchema = z.string().regex(HEX);
export const hexBytesSchema = z.string().regex(HEX_BYTES);
export const hex32Schema = z.string().regex(HEX32);
export const decimalUintSchema = z.string().regex(DECIMAL_UINT);
export const evmNetworkSchema = z.string().regex(EVM_NETWORK);

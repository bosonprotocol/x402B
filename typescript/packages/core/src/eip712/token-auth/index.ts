// Public surface for the four BPIP-12 token-authorization strategies the
// Boson escrow accepts. See docs/boson-impl-01-escrow-scheme.md §4.3.
//
// Each strategy file holds a viem-compatible typed-data builder, a hash
// helper, and a signer-recovery helper. Type definitions are reused from
// `@x402/evm/exact/client` wherever the published package exposes them
// (the ERC-3009 field list and the Permit2 `TokenPermissions` substruct);
// the rest is hand-mirrored to match the canonical EIP-2612 Permit and
// the no-witness Permit2 `PermitTransferFrom` shapes the protocol expects.

export * from "./erc3009.js";
export * from "./permit.js";
export * from "./permit2.js";
export * from "./approve.js";

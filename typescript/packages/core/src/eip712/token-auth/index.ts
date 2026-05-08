// Public surface for the four BPIP-12 token-authorization strategies the
// Boson escrow accepts. See docs/boson-impl-01-escrow-scheme.md §4.3.
//
// Each strategy file holds a viem-compatible typed-data builder, a hash
// helper, and a signer-recovery helper. In this folder, the EIP-712
// structs are hand-mirrored to match the canonical ERC-3009, EIP-2612
// Permit, and no-witness Permit2 `PermitTransferFrom` shapes the protocol
// expects. From `@x402/evm/exact/client`, we currently reuse only the
// Permit2 helpers `createPermit2ApprovalTx` and
// `getPermit2AllowanceReadParams`.

export * from "./domain.js";
export * from "./erc3009.js";
export * from "./permit.js";
export * from "./permit2.js";
export * from "./approve.js";

// Public surface for the four BPIP-12 token-authorization strategies the
// Boson escrow accepts. See docs/boson-impl-01-escrow-scheme.md §4.3.
//
// Each strategy file holds a viem-compatible typed-data builder, a hash
// helper, and a signer-recovery helper. The EIP-712 structs are hand-mirrored
// to match the canonical ERC-3009, EIP-2612 Permit, and no-witness Permit2
// `PermitTransferFrom` shapes the protocol expects.
//
// On the client side, signing now flows through `@bosonprotocol/core-sdk`'s
// `signReceiveWith{Erc3009Authorization,Erc2612Permit,Permit2}` mixin methods
// (see `@bosonprotocol/x402-client/token-auth/*.ts`). The builders here
// remain because the facilitator's signature-recovery path needs to rebuild
// the digest a buyer signed from a *known* message + nonce, and the SDK's
// helpers auto-generate or auto-fetch the nonce. KAT cross-validation tests
// guard against drift between the two type-list definitions.
//
// From `@x402/evm/exact/client`, we currently reuse only the Permit2 helpers
// `createPermit2ApprovalTx` and `getPermit2AllowanceReadParams`.

export * from "./domain.js";
export * from "./erc3009.js";
export * from "./permit.js";
export * from "./permit2.js";
export * from "./approve.js";

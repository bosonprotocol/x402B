// `TokenDomainResolver` for ERC-3009 / EIP-2612 buyer signing.
//
// `@bosonprotocol/x402-client`'s dispatcher only picks ERC-3009 or
// Permit when the caller supplies a `tokenDomainResolver` — both
// strategies sign against the **token contract's** EIP-712 domain
// (`name`, `version`), not the escrow's, and the resolver lets the
// client read those without dragging in a chain-wide config blob.
//
// The on-chain lookup itself (EIP-5267 → ERC-20 `name()` + EIP-2612
// `version()` fallback) lives in
// `@bosonprotocol/x402-core/eip712/token-auth`'s `fetchTokenDomain`, so
// the harness and the facilitator's verify path read the same domain
// from the same ABI surface — no risk of signing/verification drift.

import type { TokenDomainResolver } from "@bosonprotocol/x402-client";
import { fetchTokenDomain } from "@bosonprotocol/x402-core/eip712/token-auth";
import type { PublicClient } from "viem";

/**
 * Build a `TokenDomainResolver` backed by an on-chain `PublicClient`.
 * The same resolver works for any ERC-20 that publishes either an
 * EIP-5267 `eip712Domain()` view or the EIP-2612 `name()`/`version()`
 * pair. Used by the scenario harness to wire ERC-3009 + Permit signing
 * for whichever test token the scenario picks.
 */
export function createChainTokenDomainResolver(publicClient: PublicClient): TokenDomainResolver {
  return async (asset, chainId) => fetchTokenDomain(publicClient, asset, chainId);
}

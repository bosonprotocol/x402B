---
"@bosonprotocol/x402-facilitator": minor
---

Implement `verify()`: structural validation against the escrow-scheme
Zod schemas, scheme / network / action / strategy cross-checks against
the `PaymentRequirements`, EIP-712 signature recovery for the buyer's
meta-tx (via `@bosonprotocol/x402-core/eip712`'s
`metaTransactionTypedData` + viem's `recoverTypedDataAddress`), token-
auth signature recovery for ERC-3009 / EIP-2612 Permit / Permit2
variants (via `@bosonprotocol/x402-core/eip712/token-auth`, looking up
each token's EIP-712 domain via EIP-5267 with a `name()` / `version()`
fallback), and an on-chain simulation pre-flight via
`publicClient.call` against the `executeMetaTransaction` envelope built
by `@bosonprotocol/x402-evm/envelope` — surfaces protocol-level reverts
(duplicate nonce, expired auth, insufficient allowance, …) as
`SIMULATION_REVERT` without consuming gas.

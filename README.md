# x402b

x402b is the **Boson Protocol implementation** of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema) — a non-custodial escrow payment scheme for x402 HTTP servers.

It keeps x402's HTTP-native, gasless, single-round-trip UX and replaces the trusted-server payment model with **Boson Protocol escrow**. Funds enter a non-custodial Boson Diamond escrow at commit time; they release to the seller only after the buyer signals delivery (or the dispute window expires); a registered third-party dispute resolver can split funds and slash a seller bond if delivery fails.

The SDK is designed so that **existing x402 servers and clients can adopt it as a drop-in addition**. Servers add a Boson scheme to their `accepts[]` array; clients that understand the `escrow` scheme handle it, and those that don't fail cleanly with a structured "unsupported scheme" error — never an accidental settle.

---

## Package map

All packages publish under `@bosonprotocol/`.

| Package | Purpose |
|---|---|
| `x402-core` | `escrow` scheme JSON schemas + TypeScript types; EIP-712 builders for FullOffer (protocol domain), the protocol meta-tx envelope, and the four BPIP-12 token-auth strategies (ERC-3009 ReceiveWithAuthorization, EIP-2612 Permit, Permit2, plain approve); exchange state machine model. |
| `x402-evm` | EVM-specific implementation. Calldata builders for `ExchangeCommitFacet.createOfferAndCommit` (deferred), `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` (atomic on-chain redeem), and the `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization` envelope that carries them. Wraps `@bosonprotocol/core-sdk`. |
| `x402-server` | Framework-agnostic resource server. 402 builder, FullOffer signer wrapper, delivery negotiator, `nextActions` emitter, post-redeem endpoint set. Adapter sub-packages: `x402-server-express`, `x402-server-hono`, `x402-server-next`. |
| `x402-client` | Framework-agnostic client. Interceptor that parses the 402, picks a delivery option and a token-auth strategy, signs the meta-tx + token authorization(s), retries, then drives post-redeem actions through whichever channel is preferred. Adapters: `x402-client-axios`, `x402-client-fetch`. |
| `x402-facilitator` | Reference verify + settle service for the `escrow` scheme. Submits via `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`. |
| `x402-delivery` | Pluggable `DeliveryTransport` interface + atomic / email / XMTP / webhook / IPFS-pointer implementations. |
| `x402-actions` | Exchange state machine + channel registry. Powers the `nextActions` envelope on every server response and the post-redeem endpoint set. |
| `x402-agent` | Thin glue layer for AI-agent clients. Bridges to `bosonprotocol/agentic-commerce` MCP and lets agents pick channel (server / facilitator / on-chain / MCP) per action. |

---

## What we reuse

- `@bosonprotocol/core-sdk` — contract calls, subgraph reads, meta-tx helpers, dispute helpers.
- `@bosonprotocol/metadata` — offer metadata schemas.
- `@bosonprotocol/common` — EIP-712 hashing helpers.
- `bosonprotocol/agentic-commerce` — MCP exposing on-chain Boson actions, used by `x402-agent`.
- The Boson Redemption Widget backend hook — for human buyers of physical goods, surfaced as one of the delivery transports.

---

## Relation to x402-escrow-schema

This repo implements the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema) specification. The generic spec defines the wire format, delivery transport interface, state machine, and `nextActions` envelope. x402b provides:

- The Boson-specific `OfferCommitment` (`BosonTypes.FullOffer`, BPIP-10)
- The meta-tx entry-point (`MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`, BPIP-12)
- Boson Diamond as the escrow contract
- The `boson-` action-id prefix
- Integration with `@bosonprotocol/core-sdk` and `bosonprotocol/agentic-commerce`

---

## Spec document map

| # | File | Status |
|---|---|---|
| 00 | [boson-impl-00-overview.md](./boson-impl-00-overview.md) | detailed |
| 01 | [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) | detailed — wire format source of truth |
| 02 | [boson-impl-02-flows.md](./boson-impl-02-flows.md) | detailed — sequence diagrams |
| 03 | [boson-impl-03-delivery-transports.md](./boson-impl-03-delivery-transports.md) | detailed — pluggable delivery |
| 04 | [boson-impl-04-state-machine-and-next-actions.md](./boson-impl-04-state-machine-and-next-actions.md) | detailed — self-describing responses |
| 05 | [boson-impl-05-server-sdk.md](./boson-impl-05-server-sdk.md) | stub |
| 06 | [boson-impl-06-client-sdk.md](./boson-impl-06-client-sdk.md) | stub |
| 07 | [boson-impl-07-facilitator.md](./boson-impl-07-facilitator.md) | stub |
| 08 | [boson-impl-08-agent-mode.md](./boson-impl-08-agent-mode.md) | stub |
| 09 | [boson-impl-09-seller-metadata.md](./boson-impl-09-seller-metadata.md) | stub |


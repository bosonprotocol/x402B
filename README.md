# x402b

x402b is the **Boson Protocol implementation** of the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema) — a non-custodial escrow payment scheme for x402 HTTP servers.

It keeps x402's HTTP-native, gasless, single-round-trip UX and replaces the trusted-server payment model with **Boson Protocol escrow**. Funds enter a non-custodial Boson Diamond escrow at commit time; they release to the seller only after the buyer signals delivery (or the dispute window expires); a registered third-party dispute resolver can split funds and slash a seller bond if delivery fails.

The SDK is designed so that **existing x402 servers and clients can adopt it as a drop-in addition**. Servers add a Boson scheme to their `accepts[]` array; clients that understand the `escrow` scheme handle it, and those that don't fail cleanly with a structured "unsupported scheme" error — never an accidental settle.

---

## Package map

The logical package roles below are implementation-agnostic. Reference implementations MAY use any package names — `x402-escrow-*` is used here as a namespace convention, not a requirement.

All packages publish under `@bosonprotocol/`.

| Logical package | Purpose |
|---|---|
| `x402-core` | `escrow` scheme JSON schemas + TypeScript types; EIP-712 helpers for OfferCommitment, meta-tx envelope, and the four EVM token-auth strategies (ERC-3009, EIP-2612 Permit, Permit2, plain approve); exchange state machine model. |
| `x402-evm` | EVM-specific calldata builders for the commit-only and commit-and-release actions, and the meta-tx envelope that carries them. |
| `x402-server` | Framework-agnostic resource server. 402 builder, OfferCommitment signer (called per-request for dynamic pricing), fulfillment negotiator, `nextActions` emitter, post-commit endpoint set. Adapter sub-packages for popular frameworks. |
| `x402-client` | Framework-agnostic client. Interceptor that parses the 402, picks a fulfillment option and a token-auth strategy, signs the meta-tx + token authorization, retries, then drives post-commit actions through whichever channel is preferred. |
| `x402-facilitator` | Reference verify + settle service. Submits the buyer's meta-tx to the escrow contract and pays gas. Stateless w.r.t. funds — never custodies tokens. |
| `x402-fulfillment` | Pluggable `FulfillmentChannel` interface + inline / email / XMTP / webhook / IPFS-pointer implementations. |
| `x402-actions` | Exchange state machine + channel registry. Powers the `nextActions` envelope on every server response. Implementation-specific action tables plug in here. |
| `x402-agent` | Thin glue layer for AI-agent clients. Bridges to MCP tooling and lets agents pick channel (server / facilitator / on-chain / MCP) per action. |

---

## What we reuse

- `@bosonprotocol/core-sdk` — contract calls, subgraph reads, meta-tx helpers, dispute helpers.
- `@bosonprotocol/metadata` — offer metadata schemas.
- `@bosonprotocol/common` — EIP-712 hashing helpers.
- `bosonprotocol/agentic-commerce` — MCP exposing on-chain Boson actions, used by `x402-agent`.
- The Boson Redemption Widget backend hook — for human buyers of physical goods, surfaced as one of the fulfillment channels.

---

## Spec document map

| # | File | Status |
|---|---|---|
| 00 | [00-overview.md](https://github.com/bosonprotocol/x402-escrow-schema/blob/main/00-overview.md) | detailed |
| 01 | [01-escrow-scheme.md](https://github.com/bosonprotocol/x402-escrow-schema/blob/main/01-escrow-scheme.md) | detailed — wire format source of truth |
| 02 | [02-flows.md](https://github.com/bosonprotocol/x402-escrow-schema/blob/main/02-flows.md) | detailed — sequence diagrams |
| 03 | [03-fulfillment-channels.md](https://github.com/bosonprotocol/x402-escrow-schema/blob/main/03-fulfillment-channels.md) | detailed — fulfillment data channels |
| 04 | [04-state-machine-and-next-actions.md](https://github.com/bosonprotocol/x402-escrow-schema/blob/main/04-state-machine-and-next-actions.md) | detailed — self-describing responses |
| 05 | [05-server-sdk.md](./stubs/05-server-sdk.md) | stub |
| 06 | [06-client-sdk.md](./stubs/06-client-sdk.md) | stub |
| 07 | [07-facilitator.md](./stubs/07-facilitator.md) | stub |
| 08 | [08-agent-mode.md](./stubs/08-agent-mode.md) | stub |
| 09 | [09-seller-metadata.md](./stubs/09-seller-metadata.md) | stub |

---

## Relation to x402-escrow-schema

This repo implements the [`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema) specification. The generic spec defines the wire format, fulfillment channel interface, state machine, and `nextActions` envelope. x402b provides:

- The Boson-specific `OfferCommitment` (`BosonTypes.FullOffer`, BPIP-10)
- The meta-tx entry-point (`MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`, BPIP-12)
- Boson Diamond as the escrow contract
- The `boson-` action-id prefix
- Integration with `@bosonprotocol/core-sdk` and `bosonprotocol/agentic-commerce`

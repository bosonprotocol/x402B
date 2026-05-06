# 05 — Server SDK

> **Status:** stub (v0.1, 2026-05-04). API surface only; details to be filled during implementation.

## Goals

`@bosonprotocol/x402-server` is the framework-agnostic resource server for x402b. It:

1. Builds 402 PaymentRequirements with FullOffer + sellerSig + fulfillment options + initial nextActions.
2. Validates incoming `X-PAYMENT` payloads (per [01-escrow-scheme.md](./01-escrow-scheme.md) §5).
3. Forwards to a facilitator (or settles directly) and waits for confirmation.
4. Verifies the resulting on-chain exchange state.
5. Returns 200 + resource (or pointer) + `nextActions`.
6. Exposes optional convenience endpoints for post-redeem actions (raise/resolve/escalate/retract/decide dispute, completeExchange, redeem) — each one a thin wrapper over the on-chain call.
7. Re-emits a fresh `nextActions` envelope on every response.

Adapter sub-packages: `x402-server-express`, `x402-server-hono`, `x402-server-next`.

## Sketch

```ts
import { createX402bServer } from "@bosonprotocol/x402-server";
import { expressMiddleware } from "@bosonprotocol/x402-server-express";

const server = createX402bServer({
  network: "eip155:8453",
  diamond:    "0xDiamond...",
  signer:     sellerAssistant,           // signs FullOffer
  facilitator: { url: "https://facilitator.boson.example" },
  fulfillment:   [emailTransport(...), atomicTransport(...), xmtpTransport(...)],
  fallback:   { xmtp: "0x...", mcp: "boson://seller/12345" },
});

const requireEscrow = server.requirePayment({
  offer: () => buildFullOffer({ price: "1000000", asset: USDC_BASE, ... }),
  resource: async ({ exchangeId }) => fetchResource(exchangeId),
});

app.get("/datafeed", expressMiddleware(requireEscrow));
```

## Endpoints exposed (optional convenience)

- `POST /x402b/commit` — accepts `X-PAYMENT` with `action=boson-createOfferAndCommit`, relays the meta-tx + token-auth to the facilitator (or directly to `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`), returns 200.
- `POST /x402b/commit-and-redeem` — same, with `action=boson-createOfferCommitAndRedeem` (atomic on-chain redeem; the actual delivery may be sync or async per `fulfillment.option`).
- `POST /x402b/redeem` — server-side wrapper for `redeemVoucher`.
- `POST /x402b/complete` — wrapper for `completeExchange`.
- `POST /x402b/dispute/raise|resolve|escalate|retract` — wrappers for the dispute primitives.

Each endpoint is opt-in and configurable. The server MUST advertise the endpoint URL in the `nextActions[].endpoints.server` only if it actually implements the wrapper; otherwise it lists `["facilitator", "onchain", "mcp"]` only.

## Sections to write

- Hooks and lifecycle: `onCommitAccepted`, `onRedeem`, `onDispute`, `onComplete`.
- Seller-key management (HSM, KMS, ERC-1271 contract wallet).
- Subgraph vs direct RPC for state verification.
- Caching the 402 (TTL ≈ `maxTimeoutSeconds`).
- Rate limiting and abuse handling on the convenience endpoints.
- Multi-network configuration (one server, multiple chains advertised in `accepts[]`).

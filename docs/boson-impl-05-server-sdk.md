# 05 — Server SDK

> **Status:** stub (v0.1, 2026-05-04). API surface only; details to be filled during implementation.

## Goals

`@bosonprotocol/x402-server` is the framework-agnostic resource server for x402B. It:

1. Builds 402 PaymentRequirements with FullOffer + sellerSig + fulfillment channel options + initial nextActions.
2. Validates incoming `X-PAYMENT` payloads (per [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §5).
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
  fulfillment: [emailTransport(...), inlineTransport(...), xmtpTransport(...)],
  fallback:   { xmtp: "0x...", mcp: "boson://seller/12345" },
});

const requireEscrow = server.requirePayment({
  offer: () => buildFullOffer({ price: "1000000", asset: USDC_BASE, ... }),
  resource: async ({ exchangeId }) => fetchResource(exchangeId),
});

app.get("/datafeed", expressMiddleware(requireEscrow));
```

## Endpoints exposed (optional convenience)

- `POST /x402B/commit` — accepts `X-PAYMENT` with `action=boson-createOfferAndCommit`, relays the meta-tx + optional token-auth to the facilitator (or directly to the matching `MetaTransactionsHandlerFacet` meta-tx entrypoint), returns 200.
- `POST /x402B/commit-and-redeem` — same, with `action=boson-createOfferCommitAndRedeem` (atomic on-chain redeem; the actual delivery may be sync or async per `fulfillment.option`).
- `POST /x402B/redeem` — server-side wrapper for `redeemVoucher`.
- `POST /x402B/complete` — wrapper for `completeExchange`.
- `POST /x402B/dispute/raise|resolve|escalate|retract` — wrappers for the dispute primitives.
- `POST /x402B/withdraw-funds` — wrapper for the entity-keyed `withdrawFunds` meta-tx (see below).
- `GET /x402B/available-funds` — read-only lookup of an entity's currently available funds (see below).

Each endpoint is opt-in and configurable. The server MUST advertise the endpoint URL in the `nextActions[].endpoints.server` only if it actually implements the wrapper; otherwise it lists `["facilitator", "onchain", "mcp"]` only.

### `POST /x402B/withdraw-funds`

Entity-keyed action `boson-withdrawFunds`. Body:

```jsonc
{
  "signedPayload": "0x...",          // ABI-encoded BosonMetaTx tuple
  // Exactly one of:
  "entityId":  "12345",
  "address":   "0xabc...",
  "role":      "buyer" | "seller"    // optional; required only when `address` resolves to both
}
```

The server forwards `signedPayload` to the facilitator's `/perform-action?action=boson-withdrawFunds`. On success:

```jsonc
200 OK
{ "txHash": "0x...", "entityId": "12345", "role": "seller" }
```

The response intentionally carries **no** `nextActions` envelope — withdraw doesn't transition the exchange state machine.

### `GET /x402B/available-funds`

Read-only. Returns the current funds entity for a buyer or seller via the protocol subgraph (`coreSdk.getFunds`). Query parameters:

```text
?entityId=12345
  or
?address=0xabc...&role=buyer    // role optional
```

Response:

```jsonc
200 OK
{
  "entityId": "12345",
  "role": "seller",                // omitted when looked up by entityId
  "funds": [
    {
      "tokenAddress": "0xeee...",
      "tokenSymbol": "USDC",
      "tokenName":   "USD Coin",
      "decimals":    6,
      "availableAmount": "1500000"
    }
  ]
}
```

Failure modes: `400` for malformed `entityId` / `address` / `role`; `404` when the address resolves to no entity; `409` when the address resolves ambiguously — either to both roles with `role` omitted, or to multiple entities within a single role (one wallet registered as admin of several Boson sellers, for example). The 409 body includes `details.sellerIds` and/or `details.buyerIds` (arrays of the matching entity ids) so the caller can re-issue with an explicit `entityId`. `502` on subgraph failure.

## Fulfillment recovery — operator runbook

The commit / redeem handlers record a `FulfillmentRecoveryEntry` in `config.fulfillmentRecoveryStore` whenever a post-settle `channel.onCommit(...)` either has no registered adapter or throws. The on-chain exchange is already `REDEEMED` at that point — the buyer's funds + voucher are gone — so the entry is the host's recovery handle for the buyer's delivery target.

The returned `X402bServer` exposes two operator primitives:

```ts
server.recovery.list(): Promise<readonly FulfillmentRecoveryEntry[]>
server.recovery.replay(exchangeId: string): Promise<
  | { ok: true }
  | { ok: false; reason: string }
>
```

`list()` returns a stable snapshot of every pending entry (each entry has `exchangeId`, `option`, `data`, `redeemer`, `recordedAt`, and the last `error`). `replay(exchangeId)` re-runs `channel.onCommit(exchangeId, entry.data)` and:

- deletes the entry on success (returns `{ ok: true }`);
- leaves the entry in place with an updated `error` field on failure (returns `{ ok: false, reason }`).

Typical operator workflow:

1. Page when `server.recovery.list().length > 0` (or when growth rate exceeds a per-host threshold). The `Logger` warn events from the handlers feed the same signal in real time.
2. For each entry, decide between: (a) replay against the same channel, (b) re-route to a different channel by mutating the entry's `option` in the underlying store and replaying, (c) escalate to manual delivery.
3. After successful replay, the entry is gone; the buyer's redeem flow is fully complete.

In production deployments the recovery store MUST be backed by a persistent store (Redis / Postgres), not the in-memory `Map` default — otherwise a restart between the on-chain `REDEEMED` and the operator's replay loses the recovery handle entirely.

## Sections to write

- Hooks and lifecycle: `onCommitAccepted`, `onFulfill`, `onDispute`, `onComplete`.
- Seller-key management (HSM, KMS, ERC-1271 contract wallet).
- Subgraph vs direct RPC for state verification.
- Caching the 402 (TTL ≈ `maxTimeoutSeconds`).
- Rate limiting and abuse handling on the convenience endpoints.
- Multi-network configuration (one server, multiple chains advertised in `accepts[]`).

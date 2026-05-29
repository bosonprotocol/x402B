# 05 — Server SDK

> **Status:** implemented library surface (v0.1, updated 2026-05-29). `@bosonprotocol/x402-server` exposes the 402 challenge builder, FullOffer signer, `X-PAYMENT` validator, facilitator HTTP client, on-chain state verifier, and a full handler set covering commit, commit-and-redeem, redeem, complete, the dispute family, and entity-keyed funds withdrawal / lookup. `@bosonprotocol/x402-server-express` wires the same surface into Express middleware and an eight-route convenience router.

## Goals

`@bosonprotocol/x402-server` is the framework-agnostic resource server for x402B. It:

1. Builds 402 `PaymentRequirements` with FullOffer + sellerSig + fulfillment channel options + initial `nextActions`.
2. Validates incoming `X-PAYMENT` payloads (per [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §5).
3. Forwards to a facilitator (or settles directly) and waits for confirmation.
4. Verifies the resulting on-chain exchange state through a caller-supplied `ExchangeReader`.
5. Returns 200 + resource (or pointer) + `nextActions`.
6. Exposes convenience handlers for post-redeem actions (`redeem`, `complete`, `disputeRaise` / `Resolve` / `Retract` / `Escalate`, `withdrawFunds`, `getAvailableFunds`) — each one a thin wrapper over the on-chain call.
7. Re-emits a fresh `nextActions` envelope on every response.

Adapter sub-packages: `@bosonprotocol/x402-server-express` ships today; `x402-server-hono` and `x402-server-next` are future.

## Sketch

```ts
import { createX402bServer } from "@bosonprotocol/x402-server";
import { expressMiddleware, mountX402b } from "@bosonprotocol/x402-server-express";

const server = createX402bServer({
  network: "eip155:8453",
  chainId: 8453,
  escrow:  "0xDiamond...",
  signer:  sellerAssistant,            // signs the FullOffer (EIP-712, protocol domain)
  facilitator: { url: "https://facilitator.boson.example" },
  channelRegistry,                     // per-seller channel + endpoints registry
  exchangeReader,                      // post-settle on-chain state verifier
  subgraphUrl: "https://subgraph...",  // required for withdraw-funds / available-funds
  fulfillmentChannels: [emailChannel, inlineChannel, xmtpChannel],
});

// gate one route on a successful commit settle
app.get(
  "/datafeed",
  expressMiddleware(server, {
    resolveRequirements: async (req, mode) =>
      await server.buildPaymentRequirements(buildFor(req)),
  }),
  (req, res) => res.send(loadResource(res.locals.x402b.exchangeId)),
);

// mount the eight convenience routes under /x402B/*
app.use(mountX402b(server, { resolveRequirements: (req) => requirementsFor(req) }));
```

## Configuration

`createX402bServer(config)` runs the config through `x402bServerConfigSchema` and the cross-field
`assertChannelRegistryEscrowMatch` invariant; bad config throws synchronously (`ZodError` or `Error`)
so misconfiguration fails at boot rather than inside a 402 response. Field reference
(see [`config.ts`](../typescript/packages/server/src/config.ts)):

| Field | Required | Notes |
|---|---|---|
| `network` | yes | CAIP-2 EVM (`eip155:<chainId>`). |
| `chainId` | yes | EIP-155 chain id; the schema enforces `chainId === network.split(":")[1]`. |
| `escrow` | yes | Boson Diamond address — both the EIP-712 `verifyingContract` and the wire `escrowAddress`. Must equal `channelRegistry.escrow`. |
| `signer` | yes | `SellerSigner` — `{ address, signTypedData(...) }`. Structurally compatible with viem's `LocalAccount`; kept narrow so HSM / KMS / ERC-1271 signers plug in without depending on viem internals. |
| `facilitator` | yes | `{ url }`. Used both as the HTTP client target and as the public advertisement stamped onto `actions.next[].endpoints.facilitator`. |
| `channelRegistry` | yes | Per-seller channel + endpoint registry from `@bosonprotocol/x402-actions`. Consumed by the `nextActions` deriver. |
| `exchangeReader` | required at runtime | Pluggable on-chain reader used by every write handler for the post-settle state-verification step. Read-only paths (`signOffer`, `buildPaymentRequirements`) don't touch it. See [`onchain/verify-exchange.ts`](../typescript/packages/server/src/onchain/verify-exchange.ts). |
| `subgraphUrl` | required at runtime by `withdrawFunds` / `getAvailableFunds` | Boson subgraph URL. Lazy-constructs a read-only core-sdk on first use, or supply `coreSdkRead` to share one. |
| `coreSdkRead` | optional | Pre-built read-only core-sdk client (subgraph reads + meta-tx help). Memo-cached when omitted. |
| `exchangeFulfillmentOptionStore` | optional | Per-exchange option allowlist (Flow A). Defaults to an in-memory `Map`; multi-instance hosts plug in a shared store. |
| `fulfillmentRecoveryStore` | optional | Per-exchange retry log for redeem-side dispatch failures. See `FulfillmentRecoveryEntry.phase` for the two retry steps. |
| `fulfillmentChannels` | optional | Subset of `@bosonprotocol/x402-fulfillment`'s `FulfillmentChannel`. Required only if the host accepts redeem-time fulfillment updates; absent means redeem requests carrying `fulfillment` are rejected with `FULFILLMENT_CHANNELS_NOT_CONFIGURED`. |

## Factory surface

`createX402bServer(config) → X402bServer` (see [`server.ts`](../typescript/packages/server/src/server.ts)):

```ts
interface X402bServer {
  readonly config: X402bServerConfig;
  readonly facilitator: FacilitatorClient;

  signOffer(unsigned: UnsignedFullOffer): Promise<BosonOfferRef>;
  buildPaymentRequirements(input: BuildRequirementsInput): Promise<EscrowPaymentRequirements>;

  readonly handlers: {
    commit(input: CommitHandlerInput):            Promise<HandlerResult<CommitOk>>;
    commitAndRedeem(input: CommitHandlerInput):   Promise<HandlerResult<CommitOk>>;
    redeem(input: RedeemHandlerInput):            Promise<HandlerResult<PerformActionOk>>;
    complete(input: PerformActionInput):          Promise<HandlerResult<PerformActionOk>>;
    disputeRaise(input: PerformActionInput):      Promise<HandlerResult<PerformActionOk>>;
    disputeResolve(input: PerformActionInput):    Promise<HandlerResult<PerformActionOk>>;
    disputeRetract(input: PerformActionInput):    Promise<HandlerResult<PerformActionOk>>;
    disputeEscalate(input: PerformActionInput):   Promise<HandlerResult<PerformActionOk>>;
    withdrawFunds(input: WithdrawFundsInput):     Promise<PlainHandlerResult<WithdrawFundsOk>>;
    getAvailableFunds(query: AvailableFundsQuery): Promise<PlainHandlerResult<AvailableFundsBody>>;
  };
}
```

Every handler is awaitable and stateless w.r.t. the host. Each one returns a discriminated
`HandlerResult<T>` (or `PlainHandlerResult<T>` for entity-keyed actions that don't emit a
`nextActions` envelope) the adapter maps to HTTP status + JSON body.

## Challenge builder

`server.buildPaymentRequirements(input)` produces an `EscrowPaymentRequirements` ready to drop into
the 402 body. Inputs are the per-offer values (the per-server context is already on the factory);
the result has `actions.next[].endpoints.facilitator` stamped via the configured facilitator URL.

```ts
interface BuildRequirementsInput {
  offer: BosonOfferRef | { unsigned: UnsignedFullOffer };
  asset: string;
  amount: string;
  tokenAuthStrategies: readonly ("none" | "erc3009" | "permit" | "permit2")[];
  recipientId: string;
  maxTimeoutSeconds: number;
  fulfillment?: FulfillmentRequirements;
}
```

When `offer: { unsigned }` is passed, the server signs the FullOffer with the configured
`SellerSigner` first; pass a pre-signed `BosonOfferRef` to short-circuit. The EIP-712 signature
binds to the Boson protocol domain (see [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §4.1):

```text
domain: { name: "Boson Protocol", version: "V2", salt: bytes32(chainId), verifyingContract: <Diamond> }
type:   FullOffer(...)   // nested per BPIP-10
```

Standalone primitives `buildPaymentRequirements()` and `signFullOffer()` are also exported under
[`@bosonprotocol/x402-server/challenge`](../typescript/packages/server/src/challenge/index.ts) for
callers building requirements outside the factory.

## Payload validation

The `validate` subpath ([`validate/`](../typescript/packages/server/src/validate/index.ts)) exposes
two stateless primitives:

```ts
decodeXPaymentHeader(header: string)
  → { ok: true; payload: EscrowPaymentPayload } | { ok: false; code: DecodeErrorCode; reason: string }

validatePaymentPayload(args: { payload, requirements })
  → { ok: true; warnings?: ValidationWarning[] }
  | { ok: false; code: ValidationErrorCode; reason: string; field?: string; expected?: unknown; got?: unknown }
```

Validation short-circuits on the first failure with a structured `{ code, field, expected, got }`
body the adapter serialises into a 400. Rules 1–13 are listed in
[boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §5 and pinned in CI against the
JSON Schemas under `@bosonprotocol/x402-core/schemas/`.

The commit / commit-and-redeem handlers invoke both primitives internally, so callers driving the
factory's handler set never call them directly; they're public for callers building their own
verify path.

## Handlers

Handler input/output reference. Inputs use the wire-format shapes from
[boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) and
[boson-impl-04-state-machine-and-next-actions.md](./boson-impl-04-state-machine-and-next-actions.md);
outputs follow the discriminated `HandlerResult` pattern.

| Handler | Input | Success body |
|---|---|---|
| `commit` | `{ paymentHeader, requirements }` | `CommitOk` — `{ exchangeId, txHash, nextActions, fulfillment? }` |
| `commitAndRedeem` | `{ paymentHeader, requirements }` | `CommitOk` (atomic on-chain redeem; fulfillment dispatched per the buyer's option) |
| `redeem` | `{ exchangeId, signedPayload, fulfillment? }` | `PerformActionOk` — `{ txHash, nextActions, fulfillment? }` |
| `complete` | `{ exchangeId, signedPayload }` | `PerformActionOk` |
| `disputeRaise` / `Resolve` / `Retract` / `Escalate` | `{ exchangeId, signedPayload }` | `PerformActionOk` (`nextActions.disputeState` reflects the new state) |
| `withdrawFunds` | `{ signedPayload, entityId }` or `{ signedPayload, address, role? }` | `WithdrawFundsOk` — `{ txHash, entityId, role }` |
| `getAvailableFunds` | `{ entityId }` or `{ address, role? }` (read-only) | `AvailableFundsBody` — `{ entityId, role?, funds[] }` |

The `HandlerResult<T>` discriminant is `{ ok: true; status: 200; body: T }` vs
`{ ok: false; status: 4xx | 5xx; body: HandlerErrorBody }`; the helpers `handlerOk` /
`handlerErr` / `plainHandlerOk` (re-exported from `@bosonprotocol/x402-server/handlers`) construct
both shapes. Write handlers emit a fresh `nextActions` envelope on every success via
`emitNextActions()` — the channel registry + state-machine deriver produce the next set of legal
actions for the post-state. `withdrawFunds` and `getAvailableFunds` intentionally use
`PlainHandlerResult` (no `nextActions`) because they don't transition the exchange state machine.

### Post-settle state verification

Every write handler runs a post-settle verification step against the configured `ExchangeReader`
before returning success — settling and reading on-chain state are two separate operations and the
gap is a race. The reader is an opaque interface (subgraph, RPC, core-sdk-backed, in-memory for
tests) so callers can wire whatever they trust:

```ts
interface ExchangeReader {
  read(exchangeId: string): Promise<ExchangeSnapshot>;
}
```

`verifyExchange()` and `verifyExchangeSnapshot()` are exposed under
[`@bosonprotocol/x402-server/onchain`](../typescript/packages/server/src/onchain/index.ts) for
callers that need the comparison logic outside a handler.

## Facilitator client

`createFacilitatorClient({ url })` returns a `FacilitatorClient` with `verify()`, `settle()`, and
`performAction()` bound to the configured URL. The factory wires one into `server.facilitator`
automatically; the client is also exposed under
[`@bosonprotocol/x402-server/facilitator`](../typescript/packages/server/src/facilitator/index.ts)
for advanced compositions (e.g. mocking in tests, or driving `performAction` outside the handler
set). Wire types (`FacilitatorVerifyInput` / `FacilitatorSettleInput` /
`FacilitatorPerformActionInput` and their result shapes) are re-exported from
`@bosonprotocol/x402-facilitator` so consumers don't need a second import.

See [boson-impl-07-facilitator.md](./boson-impl-07-facilitator.md) for endpoint contracts.

## Convenience endpoints

Each `handlers.*` method has a one-to-one mapping with a convenience HTTP route on the express
adapter. The server MUST advertise the endpoint URL in `actions.next[].endpoints.server` only if it
actually implements the wrapper; otherwise it lists `["facilitator", "onchain", "mcp"]` only.

- `POST /x402B/commit` — accepts `X-PAYMENT` with `action=boson-createOfferAndCommit`, relays the meta-tx + optional token-auth to the facilitator (or directly to the matching `MetaTransactionsHandlerFacet` meta-tx entrypoint), returns 200.
- `POST /x402B/commit-and-redeem` — same, with `action=boson-createOfferCommitAndRedeem` (atomic on-chain redeem; the actual delivery may be sync or async per `fulfillment.option`).
- `POST /x402B/redeem` — server-side wrapper for `redeemVoucher`.
- `POST /x402B/complete` — wrapper for `completeExchange`.
- `POST /x402B/dispute/raise|resolve|escalate|retract` — wrappers for the dispute primitives.
- `POST /x402B/withdraw-funds` — wrapper for the entity-keyed `withdrawFunds` meta-tx (see below).
- `GET /x402B/available-funds` — read-only lookup of an entity's currently available funds (see below).

Each endpoint is opt-in and configurable.

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

The commit / redeem handlers record a `FulfillmentRecoveryEntry` in `config.fulfillmentRecoveryStore` whenever a post-settle channel step is pending — either `channel.onCommit(...)` had no registered adapter or threw, or `onCommit` persisted but the subsequent `channel.onFulfill(...)` dispatch failed. The on-chain exchange is already `REDEEMED` at that point — the buyer's funds + voucher are gone — so the entry is the host's recovery handle for the still-pending channel work. The entry's `phase` field (`"commit"` | `"delivery"`) records which step is outstanding.

The returned `X402bServer` exposes two operator primitives:

```ts
server.recovery.list(): Promise<readonly FulfillmentRecoveryEntry[]>
server.recovery.replay(exchangeId: string): Promise<
  | { ok: true }
  | { ok: false; reason: string }
>
```

`list()` returns a stable snapshot of every pending entry (each entry has `exchangeId`, `option`, `data`, `redeemer`, `recordedAt`, `phase`, and the last `error`). `replay(exchangeId)` branches on `entry.phase`:

- `"commit"` — re-runs `channel.onCommit(exchangeId, entry.data)`;
- `"delivery"` — re-runs `channel.onFulfill(exchangeId)` (the prior `onCommit` already persisted; replaying it would silently skip the still-pending delivery dispatch).

In both cases the entry is deleted on success (returns `{ ok: true }`) and left in place with an updated `error` field on failure (returns `{ ok: false, reason }`). A `"delivery"` entry whose channel has no `onFulfill` returns `{ ok: false }` with the entry retained.

Typical operator workflow:

1. Page when `server.recovery.list().length > 0` (or when growth rate exceeds a per-host threshold). The `Logger` warn events from the handlers feed the same signal in real time.
2. For each entry, decide between: (a) replay against the same channel, (b) re-route to a different channel by mutating the entry's `option` in the underlying store and replaying, (c) escalate to manual delivery.
3. After successful replay, the entry is gone; the buyer's redeem flow is fully complete.

In production deployments the recovery store MUST be backed by a persistent store (Redis / Postgres), not the in-memory `Map` default — otherwise a restart between the on-chain `REDEEMED` and the operator's replay loses the recovery handle entirely.

## Health check

`server.healthCheck()` returns a per-dependency liveness snapshot:

```ts
type HealthState = "ok" | "down" | "n/a";

healthCheck(): Promise<{
  facilitator: HealthState;
  subgraph: HealthState;
}>;
```

`facilitator` probes the facilitator's `GET /healthz` endpoint via the configured HTTP client; any 2xx is `"ok"`, network errors and non-2xx responses are `"down"`. `subgraph` probes a cheap `coreSdk.getSellersByAddress(0x0)` read; the same `ok` / `down` mapping applies, and the dependency reports `"n/a"` when neither `coreSdkRead` nor `subgraphUrl` is configured (commit / redeem-only servers don't need a subgraph).

The SDK stays framework-free — `healthCheck()` is just an async function the host can mount behind whatever route their framework uses. A typical Express adapter:

```ts
app.get("/healthz", async (_req, res) => {
  const health = await server.healthCheck();
  const allOk = health.facilitator === "ok" && (health.subgraph === "ok" || health.subgraph === "n/a");
  res.status(allOk ? 200 : 503).json(health);
});
```

## Express adapter

`@bosonprotocol/x402-server-express` is a thin wrapper — all logic lives in the framework-agnostic
package. Two exports
(see [`server-express/src/index.ts`](../typescript/packages/server-express/src/index.ts)):

### `expressMiddleware(server, opts)`

```ts
interface ExpressMiddlewareOptions {
  resolveRequirements: (
    req: Request,
    mode: "challenge" | "settle",
  ) => Promise<EscrowPaymentRequirements> | EscrowPaymentRequirements;
  flow?: "commit" | "commit-and-redeem";
}
```

Gates a single route on a successful commit-time settle. When `X-PAYMENT` is missing the middleware
responds with 402 + the resolved `EscrowPaymentRequirements`. When it's present the middleware
dispatches to `server.handlers.commit` (Flow A) or `server.handlers.commitAndRedeem` (Flow B);
without `opts.flow` it peeks at the payload's `action` field and dispatches accordingly. The
handler's success body is attached to `res.locals.x402b` (typed via the merged `Express.Locals`
interface — `X402bResLocals`); the buyer-facing `X-PAYMENT-RESPONSE` header is stamped with a
base64-of-JSON encoding of the same body. The route's downstream handler reads `res.locals.x402b`
and serves the resource.

### `mountX402b(server, opts)`

```ts
interface MountX402bOptions {
  resolveRequirements: (req: Request) => Promise<EscrowPaymentRequirements> | EscrowPaymentRequirements;
  basePath?: string;
}
```

Returns an `express.Router` wiring the eight `POST /x402B/*` convenience routes (plus a `GET` for
`/available-funds`). By default the router registers both the canonical `/x402B` paths and the
legacy `/x402b` aliases. Bodies that don't shape-match (missing fields, non-hex `signedPayload`,
both/none of `entityId` and `address`) get a `400` with `{ code: "INVALID_REQUEST_BODY", reason }`
before the handler is invoked. The shared `INVALID_REQUEST_BODY` constant is exported for callers
that want to branch on the code.

Post-commit routes don't stamp `X-PAYMENT-RESPONSE` — that header is reserved for commit-time
settlements that consumed a payment.

## Future additions

- Lifecycle hooks (`onCommitAccepted`, `onFulfill`, `onDispute`, `onComplete`) for hosts that want to react without intercepting the handler chain.
- Seller-key management guidance for HSM / KMS / ERC-1271 contract-wallet signers.
- 402 challenge caching (TTL ≈ `maxTimeoutSeconds`) so popular endpoints don't re-sign on every request.
- Rate limiting and abuse handling on the convenience endpoints.
- Multi-network configuration (one server, multiple chains advertised in `accepts[]`).
- `@bosonprotocol/x402-server-hono` and `@bosonprotocol/x402-server-next` adapters.

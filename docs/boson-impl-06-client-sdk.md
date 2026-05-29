# 06 — Client SDK

> **Status:** implemented library surface (v0.1, updated 2026-05-29). `@bosonprotocol/x402-client` exposes `handle402` (commit-time `X-PAYMENT` builder), `signAction` / `submitAction` (post-commit meta-tx signer + HTTP channel walk), `signWithdrawFunds` / `signWithdrawAllAvailableFunds` (entity-keyed funds withdrawal), and `parsePaymentResponse` (decoder for the `X-PAYMENT-RESPONSE` header). `@bosonprotocol/x402-client-fetch` wraps a native `fetch` so 402 responses are signed and retried transparently; `@bosonprotocol/x402-paywall` is the React + wagmi browser paywall for human buyers.

## Goals

`@bosonprotocol/x402-client` is the framework-agnostic client. It:

1. Intercepts 402 responses with `scheme: "escrow"`.
2. Negotiates the fulfillment channel.
3. Decides between `createOfferAndCommit` (commit now, redeem later) and `createOfferCommitAndRedeem` (commit and redeem in one tx, regardless of when the resource is delivered) based on the buyer's policy and what `actions.next[]` allows. This is independent of the chosen fulfillment channel.
4. Picks a token-authorization strategy from `tokenAuthStrategies` (one of `none`, `erc3009`, `permit`, `permit2` per [BPIP-12](https://github.com/zajck/BPIPs/blob/authorized-token-transfer-metaTx/content/BPIP-12.md)).
5. Builds and signs the protocol meta-tx envelope (always) plus the token-transfer authorization for the chosen strategy (omitted for `none`).
6. Retries the request with `X-PAYMENT`.
7. Drives all post-200 actions (redeem, complete, dispute) via whichever channel the buyer/agent prefers, with fallback through the channel order.
8. Verifies on-chain state where the server's claims are load-bearing.

Adapter sub-packages: `@bosonprotocol/x402-client-fetch` (native fetch) and
`@bosonprotocol/x402-paywall` (React + wagmi browser paywall) ship today;
`x402-client-axios` is future.

## Sketch

```ts
import { createX402bClient } from "@bosonprotocol/x402-client";
import { wrapFetchWithPayment } from "@bosonprotocol/x402-client-fetch";

const client = createX402bClient({
  signer: {
    // viem `LocalAccount` exposes `.address` (sync); the x402-client `Signer`
    // interface returns `Promise<Address>` — adapt with a tiny wrapper.
    getAddress:    async () => buyerWallet.address,
    signTypedData: buyerWallet.signTypedData,
  },
  subgraphUrls:          { 8453: "https://subgraph..." },
  tokenDomainResolver:   async (asset, chainId) => USDC_EIP712_DOMAINS[chainId],
  policy: {
    redeemMode:        "auto",                   // "auto" | "commit-only" | "commit-and-redeem"
    tokenAuthStrategy: undefined,                // omit to let the dispatcher pick
    maxAmount:         "100000000",              // safety cap, atomic units
  },
  fulfillment: { option: "inline", data: null }, // required when requirements demand fulfillment
});

const fetchWithPayment = wrapFetchWithPayment(fetch, client, { commitFallback: "auto" });

const res = await fetchWithPayment("https://seller.example/datafeed");
const summary = client.parsePaymentResponse(res); // { exchangeId, state }

// drive a post-commit action through whichever channel the server advertises first
await client.submitAction({
  actionId:        "boson-completeExchange",
  exchangeId:      summary!.exchangeId!,
  network:         "eip155:8453",
  escrowAddress:   "0xDiamond...",
  priorNextActions: prior.nextActions,
});
```

## Configuration

`createX402bClient(config) → X402bClient` (see [`client.ts`](../typescript/packages/client/src/client.ts) and [`types.ts`](../typescript/packages/client/src/types.ts)).
Field reference:

| Field | Required | Notes |
|---|---|---|
| `signer` | yes | `Signer` — `{ getAddress(), signTypedData(args) }`. A viem `LocalAccount` needs a tiny inline wrapper (its `.address` is sync while `Signer.getAddress` returns `Promise<Address>`); a `@bosonprotocol/ethers-sdk` adapter can use the bundled `signerFromEthersAdapter` helper. |
| `subgraphUrls` | optional | Per-chain Boson subgraph URLs keyed by EIP-155 chain id. Pure signing flows can omit it — the client falls back to a placeholder URL that is never read (see [`core-sdk-factory.ts`](../typescript/packages/client/src/core-sdk-factory.ts)). Required only when the buyer actually queries the subgraph, e.g. through `signWithdrawAllAvailableFunds`. |
| `publicClients` | optional | Per-chain viem `PublicClient`s, keyed by chain id. Required for the EIP-2612 Permit strategy (fetches `nonces(owner)` before signing); other strategies don't need them. |
| `tokenDomainResolver` | optional | Resolves the EIP-712 domain a given ERC-20 publishes for ERC-3009 / EIP-2612 signatures. Usually a small in-memory lookup keyed by `(chainId, asset)`. Permit2 doesn't use the token's domain and signs without this. |
| `policy.redeemMode` | optional, default `"auto"` | See "402 handling" → decision tree. |
| `policy.tokenAuthStrategy` | optional | Forces a specific strategy from the server's advertised set. See "402 handling" → token-auth decision tree. |
| `policy.maxAmount` | optional | Atomic-units cap. If set, the client rejects requirements whose `amount` exceeds it (throws `MaxAmountExceededError`). |
| `fulfillment` | required iff `requirements.fulfillment.required` | `{ option, data }`. Validated locally against the chosen option's JSON Schema before signing — fails fast with `FulfillmentValidationError`. |

The underlying `CoreSDK` is built lazily per `(chainId, escrowAddress)` and memo-cached across
calls — both `handle402` and `signAction` reuse it.

## Factory surface

```ts
interface X402bClient {
  handle402(requirements: unknown): Promise<string>;                       // -> base64 X-PAYMENT
  signAction(args: SignActionArgs): Promise<SignedPostCommitAction>;       // sign-only
  submitAction(args: SubmitActionArgs): Promise<SubmitResult>;             // sign + channel walk
  signWithdrawFunds(args: SignWithdrawFundsArgs): Promise<SignedWithdrawFunds>;
  signWithdrawAllAvailableFunds(args: SignWithdrawAllAvailableFundsArgs): Promise<SignedWithdrawFunds>;
  parsePaymentResponse(response: { headers: { get(name: string): string | null } }): ExchangeSummary | undefined;
}
```

## 402 handling — `handle402(requirements)`

Consumes a parsed escrow `PaymentRequirements` and returns the base64 value to set as the
`X-PAYMENT` header on the retry. The internal flow:

1. **Parse and validate** the requirements via `parseEscrowPaymentRequirements`.
2. **Pick the on-chain action** — see decision tree below.
3. **Resolve the fulfillment slot** — locally validates `{ option, data }` against the chosen option's JSON Schema; raises `FulfillmentValidationError` on mismatch.
4. **Enforce `policy.maxAmount`** — throws `MaxAmountExceededError` when `requirements.amount > policy.maxAmount`.
5. **Pick a token-auth strategy** and sign — see token-auth decision tree below.
6. **Sign the protocol meta-tx** (`signCreateOfferAndCommit` for Flow A, `signCreateOfferCommitAndRedeem` for Flow B). EIP-712 against the Boson protocol Diamond domain (see [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §4.2).
7. **Assemble and encode the payload** — base64-of-JSON of the wire `EscrowPaymentPayload`. Flow B carries `fulfillment.data` inline; Flow A defers it to the redeem POST body (see [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §3, rule 13).

### Decision tree — `policy.redeemMode`

The mode controls the on-chain redemption phase, independent of when the resource is delivered.
See [`action.ts`](../typescript/packages/client/src/action.ts):

| `redeemMode` | Behaviour |
|---|---|
| `"auto"` (default) | Prefer Flow A (`boson-createOfferAndCommit`) when advertised on the `server` channel; fall back to Flow B (`boson-createOfferCommitAndRedeem`) when only that is offered. |
| `"commit-only"` | Require Flow A on the `server` channel; otherwise throw `NoCompatibleActionError`. |
| `"commit-and-redeem"` | Require Flow B on the `server` channel; otherwise throw `NoCompatibleActionError`. |

### Decision tree — `policy.tokenAuthStrategy`

Without an override, the token-auth dispatcher in `@bosonprotocol/x402-core` walks the server's
advertised set by preference (`erc3009` → `permit2` → `permit`) and signs the first viable one.
`"none"` is never auto-picked — the dispatcher's preference order skips it because the buyer must
have already approved the Diamond off-band.

`policy.tokenAuthStrategy` forces a specific value from `requirements.tokenAuthStrategies`. Out-of-set values throw `UnsupportedTokenAuthError`. The `"none"` override short-circuits the dispatcher (no token-auth payload is sent); other forced values invoke the dispatcher with the advertised set narrowed to a single element so it must pick the requested one. The four advertised strategies are documented in detail at [boson-impl-01-escrow-scheme.md](./boson-impl-01-escrow-scheme.md) §4.3.

## Post-commit submission — `signAction` / `submitAction`

`signAction(args)` signs one of the buyer's post-commit meta-transactions and returns:

```ts
interface SignedPostCommitAction {
  metaTx: BosonMetaTx;        // wire envelope — for onchain / MCP channels
  signedPayload: Hex;         // ABI-encoded BosonMetaTx — for server / facilitator HTTP channels
}
```

The dispatcher maps each `actionId` to the matching `CoreSDK.signMetaTx*` mixin
(see [`post-commit.ts`](../typescript/packages/client/src/post-commit.ts)):

| `actionId` | Core-sdk method |
|---|---|
| `boson-redeem` | `signMetaTxRedeemVoucher` |
| `boson-cancelVoucher` | `signMetaTxCancelVoucher` |
| `boson-completeExchange` | `signMetaTxCompleteExchange` |
| `boson-raiseDispute` | `signMetaTxRaiseDispute` |
| `boson-retractDispute` | `signMetaTxRetractDispute` |
| `boson-escalateDispute` | `signMetaTxEscalateDispute` |
| `boson-resolveDispute` | `signMetaTxResolveDispute` (also takes `buyerPercent` + `counterpartySig`) |

`boson-revokeVoucher` is seller-only and not exposed on the buyer client; `boson-withdrawFunds` is
entity-keyed and lives on `signWithdrawFunds(All)()` instead. `boson-escalateDispute` currently
signs only the meta-tx — the resolver-deposit wrapper (resolver responds with its own 402 carrying
an `escrow` `PaymentRequirements`) is future.

`submitAction(args)` layers signing + HTTP channel walk into one call. It signs via `signAction`,
finds the matching entry in `priorNextActions.next[]` by `actionId`, then walks the entry's
`channels[]` array — intersected with `["server", "facilitator"]` — sending the signed payload to
the first responsive endpoint. The walk semantics
(see [`submit.ts`](../typescript/packages/client/src/submit.ts)):

- **2xx** → return normalized `SubmitResult` immediately. The `server` channel produces the rich `{ txHash, nextActions, fulfillment? }` envelope; the `facilitator` channel produces `{ ok, txHash, newExchangeState, newDisputeState? }`. The result type intersects to `{ txHash, newExchangeState, newDisputeState?, nextActions?, channelUsed, attempts }`.
- **5xx / network error / timeout / invalid-2xx-body** → fall back to the next channel.
- **4xx** → terminal. A buyer-payload error fallback can't fix, so the submitter throws `AllChannelsFailedError` immediately with the attempt log.
- **No HTTP-compatible channel advertised** → `NoCompatibleChannelError`.
- **All channels exhausted without a 2xx** → `AllChannelsFailedError` with the full per-channel attempt log on `.attempts`.

Per-channel timeout defaults to 10 000 ms; override via `args.timeoutMs`. The `onchain` / `mcp` /
`xmtp` channels are out of scope for `submitAction` — the onchain submitter needs a wallet client
plumbed through client config and tx-receipt waiting; the agentic channels need the future
`@bosonprotocol/x402-agent` package. Callers whose `action.channels` only list those will hit
`NoCompatibleChannelError`. Callers who'd rather keep dispatch outside the SDK can still call
`signAction` directly and POST themselves.

## Error surface

All errors are leaf `Error` subclasses with stable `name` fields for `instanceof` and string
branching (see [`errors.ts`](../typescript/packages/client/src/errors.ts) and
[`submit.ts`](../typescript/packages/client/src/submit.ts)):

| Error | Trigger | Recovery |
|---|---|---|
| `UnsupportedSchemeError` | The 402 body doesn't advertise an `escrow` accept entry. | Surface to the caller — the buyer hasn't installed an `escrow`-aware client for this 402. |
| `UnsupportedTokenAuthError` | `policy.tokenAuthStrategy` not in `requirements.tokenAuthStrategies`, or none of the advertised strategies can be built (e.g. EIP-2612 Permit without a `publicClient`). | Loosen the policy override, or add the missing `publicClient` / `tokenDomainResolver`. |
| `MaxAmountExceededError` | `requirements.amount > policy.maxAmount`. | Raise the cap or refuse the offer. |
| `NoCompatibleActionError` | The 402 doesn't advertise any commit-time action compatible with `policy.redeemMode`. | Loosen the policy (e.g. drop from `"commit-only"` to `"auto"`). |
| `FulfillmentValidationError` | Buyer's `{ option, data }` doesn't match an advertised option, or `data` fails the option's JSON Schema. | Surface the validation message to the buyer; re-issue with corrected data. |
| `NoCompatibleChannelError` | `submitAction` — the matching `nextActions` entry advertises only non-HTTP channels (`onchain` / `mcp` / `xmtp`). | Drive the action outside the SDK, or wait for the onchain / agent submitter. |
| `AllChannelsFailedError` | `submitAction` — every attempted channel failed (or a 4xx fast-failed). `.attempts` carries the per-channel log. | Branch on the final attempt — 4xx → fix payload; 5xx-everywhere → upstream outage. |

## Withdraw and read

`signWithdrawFunds(args)` signs the entity-keyed `withdrawFunds(entityId, tokenList, tokenAmounts)`
meta-tx against the configured Diamond domain. The caller supplies the exact snapshot to commit to.

`signWithdrawAllAvailableFunds(args)` reads the funds entity from the subgraph, drops zero
balances, and signs `withdrawFunds(entityId, allTokens, allAmounts)`. Accepts either an `entityId`
directly or an `address` (with optional `role` for ambiguous wallets); throws when the address
resolves to multiple seller / buyer entities and `role` doesn't disambiguate. Throws when the
entity has no available funds.

Both return the same `SignedWithdrawFunds` shape — `{ metaTx, signedPayload, entityId, tokenList,
tokenAmounts }` — ready to POST to the server's `/x402B/withdraw-funds` route or the facilitator's
`/perform-action?action=boson-withdrawFunds` directly. The matching server-side endpoints are
documented in [boson-impl-05-server-sdk.md](./boson-impl-05-server-sdk.md#post-x402bwithdraw-funds).

## `X-PAYMENT-RESPONSE` parsing — `parsePaymentResponse`

After a successful settle the resource server stamps a base64-of-JSON `X-PAYMENT-RESPONSE` header
on the 200 response. `client.parsePaymentResponse(response)` decodes it into an `ExchangeSummary`:

```ts
interface ExchangeSummary {
  raw?: unknown;
  exchangeId?: string;
  state?: ClientState;
}
```

The decoder is permissive — `raw` is the full payload; `exchangeId` / `state` are best-effort lifts
from common property paths. Returns `undefined` when the header isn't present.

## Fetch adapter

`@bosonprotocol/x402-client-fetch` wraps a native `fetch` so 402 responses carrying
`scheme: "escrow"` are signed and retried automatically. The package re-exports the entire
`@bosonprotocol/x402-client` public API so a consumer pulling the fetch adapter gets everything in
one import.

```ts
function wrapFetchWithPayment(
  originalFetch: typeof fetch,
  client: X402bClient,
  options?: WrapFetchOptions,
): typeof fetch;

interface WrapFetchOptions {
  commitFallback?: "off" | "auto";   // default "off"
  facilitatorTimeoutMs?: number;     // default 10000
}
```

Behaviour (see [`client-fetch/src/wrap.ts`](../typescript/packages/client-fetch/src/wrap.ts)):

1. Run the original request.
2. If the response is not `402` → return as-is.
3. Try to parse the body as JSON and look for an `accepts[]` entry with `scheme === "escrow"` via `findEscrowAccept(body)`. If none is present, return the original 402 unchanged (so a non-Boson client higher up the stack can still try).
4. Delegate the matched requirements to `client.handle402(...)` → base64 `X-PAYMENT` header.
5. Re-issue the request with the new header set.
6. Return the retry response. A second 402 is NOT re-retried — the server has spoken twice.

### Session-id isolation

Every wrapper invocation mints a fresh UUID and stamps it on the `X-X402-Boson-Session-Id` header
(exported as `SESSION_ID_HEADER`) on **both** the initial request and the retry. The example
resource server uses this id to scope its `FullOffer` cache: the 402 challenge and the `X-PAYMENT`
retry share one offer (the validator deep-equals `payload.offerRef.fullOffer` against
`requirements.offer.fullOffer`), while distinct buyer flows see distinct offers so a
single-quantity offer isn't accidentally served to two commits in a row.

### Commit fallback (opt-in)

When `commitFallback: "auto"` is set, a resource-server 5xx / network error / timeout on the
retry no longer fails the call. Instead the wrapper recovers the `EscrowPaymentPayload` from the
base64 header, looks up `requirements.actions.next[*].endpoints.facilitator` for the chosen commit
action, and POSTs `{ scheme, network, payload, requirements }` directly to the facilitator's
`/settle` route. On a 2xx the wrapper synthesizes a 200 response carrying:

- `X-PAYMENT-RESPONSE`: base64-of-JSON `{ exchangeId, txHash, nextActions: { exchangeState } }` so existing `client.parsePaymentResponse(...)` continues to work.
- `X-X402-Boson-Commit-Channel: facilitator`: marker so the caller can detect that fallback was used.
- `X-X402-Boson-Server-Error: <status-or-message>`: original failure for diagnostics.
- Empty body — the resource itself comes from the resource server, which by definition is unreachable; callers that need the resource come back later (re-GET when the server is up, or rely on the seller's asynchronous fulfillment channel).

Default `"off"`: existing callers don't get a different response shape from a brief upstream blip.

## Paywall

`@bosonprotocol/x402-paywall` is the React + wagmi browser paywall for human buyers. It renders a
`FullOffer`, connects a wallet via wagmi, drives the atomic commit-and-redeem flow, and returns
the resource — mirroring the upstream `@x402/paywall` `PaywallProvider` contract. The paywall
depends on `@bosonprotocol/x402-client-browser` (the browser-friendly entry point of the client
SDK) and follows the same `SESSION_ID_HEADER` semantics as the fetch adapter — a fresh session id
per Pay click isolates the resource server's offer cache for the duration of the buyer flow.

Detailed component docs and the wagmi configuration live in the package README at
[typescript/packages/paywall/README.md](../typescript/packages/paywall/README.md); this doc only
covers how the paywall composes with the client SDK.

## Future additions

- ERC-1271 (contract-wallet) buyer support — sign verification path for smart-account wallets.
- Local persistence of in-flight exchanges (so a crash doesn't lose the buyer's state).
- Optional UI hook surface for human buyers — `ui.collect`, `ui.confirm`, `ui.notify`.
- React hooks (`useX402b`, `useExchange`, `usePerformAction`) in a sibling react package distinct from the wagmi paywall.
- `@bosonprotocol/x402-client-axios` adapter.
- MCP channel + on-chain (wallet-submitter) channel for `submitAction` — gated on the future `@bosonprotocol/x402-agent` package and on-chain submitter work. Tracked in `x402-e2e/_skeletons.test.ts` `@p2` scenarios D4 / D5 / A8.

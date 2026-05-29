# Flow D — Channels & `nextActions`

> Walkthrough of how the protocol stays self-describing and how the buyer
> reaches each action through more than one transport. Spec counterparts:
> [`docs/boson-impl-02-flows.md` § Flow D](../../../../../docs/boson-impl-02-flows.md)
> and [`docs/boson-impl-04-state-machine-and-next-actions.md`](../../../../../docs/boson-impl-04-state-machine-and-next-actions.md).

## Overview & context

x402B is a long-lived protocol: after commit, the buyer may redeem,
dispute, complete, etc. across many round-trips. Two properties keep that
robust, and both are what this flow documents:

1. **Self-description.** Every server response carries a `nextActions`
   envelope listing exactly the legal transitions from the current state,
   each tagged with the **channels** through which it can be invoked
   (`server`, `facilitator`, `onchain`, `mcp`, `xmtp`). The client never
   hard-codes the state machine.
2. **Channel independence.** The same protocol action can be invoked
   through different transports. A server that withholds an endpoint or
   disappears doesn't strand the buyer — `onchain` is always available.

The e2e suite proves both with concrete evidence rather than the abstract
model: the **D-series** asserts that the envelope on the wire matches the
protocol's `clientLegalActions(state)` table, and the **B7 cancel** path
shows the *same* action class travelling a *different* channel
(facilitator) when the server has no route for it.

### Scenarios on this flow

| ID | What it pins | Test |
|---|---|---|
| **D1** | Post-commit `nextActions[]` == `clientLegalActions(COMMITTED)`, carried on the `X-PAYMENT-RESPONSE` header | [`next-actions.test.ts:66`](../../test/scenarios/next-actions.test.ts#L66) |
| **D2** | Post-redeem `nextActions[]` shrinks to `clientLegalActions(REDEEMED)`, carried on the redeem response body | [`next-actions.test.ts:86`](../../test/scenarios/next-actions.test.ts#L86) |
| **B7** | Same action class, facilitator channel: `cancelVoucher` via the facilitator's generic `/perform-action` (no server route) | [`post-commit.test.ts:311`](../../test/scenarios/post-commit.test.ts#L311) |

## Actors

| Actor | Role in this flow | Defined in |
|---|---|---|
| **Buyer / client** | Reads `nextActions`, picks a channel for each transition | [`src/harness/buyer-actor.ts`](../../src/harness/buyer-actor.ts) |
| **Resource server** (`server` channel) | Derives `nextActions` (`deriveNextActions`); exposes `/x402B/*` convenience routes | [`actions/src/derive.ts`](../../../actions/src/derive.ts), [`server-express/src/mount.ts`](../../../server-express/src/mount.ts) |
| **Facilitator** (`facilitator` channel) | Generic `POST /perform-action` relay for any signed meta-tx | [`facilitator/src/perform-action/index.ts`](../../../facilitator/src/perform-action/index.ts) |
| **Boson Diamond** (`onchain` channel) | Direct submission — the always-available fallback | — |
| **MCP / XMTP** | Registry channels advertised in `fallback`; not exercised by the suite | — |

## Sequence diagram

The envelope on each hop (D1/D2), and the same action reaching the Diamond
through two different channels (B-series server route vs B7 facilitator):

```mermaid
sequenceDiagram
    autonumber
    participant B as BuyerActor
    participant S as Resource Server
    participant F as Facilitator
    participant D as Boson Diamond

    Note over B,S: D1 — commit envelope rides the X-PAYMENT-RESPONSE header
    B->>S: GET /resource + X-PAYMENT
    S->>S: deriveNextActions(exchange) → clientLegalActions(COMMITTED)
    S-->>B: 200 + X-PAYMENT-RESPONSE: base64{ exchangeState:"COMMITTED",<br/>next:[redeem, cancelVoucher, raiseDispute*…] }
    Note over B: assert next[] == clientLegalActions(COMMITTED)

    Note over B,S: D2 — redeem envelope rides the response body; set shrinks
    B->>S: POST /x402B/redeem  (server channel)
    S-->>B: { nextActions:{ exchangeState:"REDEEMED",<br/>next:[completeExchange, raiseDispute] } }
    Note over B: assert next[] == clientLegalActions(REDEEMED)

    Note over B,D: Same action, different channels
    alt server channel (B1–B6)
        B->>S: POST /x402B/redeem | /complete | /dispute/*
        S->>F: POST /perform-action
        F->>D: executeMetaTransaction → <primitive>
    else facilitator channel (B7 cancelVoucher — no server route)
        B->>F: POST /perform-action { action, exchangeId, network, escrowAddress, signedPayload }
        F->>D: executeMetaTransaction → cancelVoucher
    else onchain channel (always available)
        B->>D: executeMetaTransaction(...) directly
    end
```

## Step-by-step walkthrough

### D1 — the post-commit envelope matches the legal-action table

After a successful commit, `readXPaymentResponse(res.headers)` decodes the
`X-PAYMENT-RESPONSE` header into `{ exchangeId, txHash, nextActions }`
([`next-actions.test.ts:70`](../../test/scenarios/next-actions.test.ts#L70)).
The test asserts:

- `decoded.nextActions.exchangeState === ExchangeState.COMMITTED`, and
- the set of `decoded.nextActions.next[].id` equals
  `clientLegalActions({ exchange: ExchangeState.COMMITTED })`
  ([`next-actions.test.ts:81`](../../test/scenarios/next-actions.test.ts#L81)).

`clientLegalActions` ([`transitions.ts:98`](../../../core/src/state-machine/transitions.ts#L98))
is the same source `deriveNextActions` reads on the server, so D1 proves
the live server stamped the correct state and emitted the matching action
set across the HTTP hop — not just that a unit-level helper returns the
right list.

### D2 — the set shrinks after redeem

The test commits then redeems, and asserts
`redeemed.nextActionIds` (the ids the harness pulls from the redeem
response's `nextActions.next[]`, [`post-commit-http.ts:96`](../../src/harness/post-commit-http.ts#L96))
equals `clientLegalActions({ exchange: ExchangeState.REDEEMED })`
([`next-actions.test.ts:111`](../../test/scenarios/next-actions.test.ts#L111)).
`redeem` and `cancelVoucher` have dropped off; `completeExchange` and
`raiseDispute` have appeared — the envelope tracks the state machine, hop
by hop. Note the two envelopes ride different parts of the response: the
commit envelope is on the `X-PAYMENT-RESPONSE` **header**, the redeem
envelope is in the response **body**.

### Channel independence in practice

The suite drives post-commit actions through two channels, proving the
transport is interchangeable for a given protocol action:

- **`server` channel** — `performBuyerPostCommitAction`
  ([`post-commit-http.ts:129`](../../src/harness/post-commit-http.ts#L129))
  `POST`s to the seller's `/x402B/<route>`; the server relays to the
  facilitator. Used by B1–B6 (redeem, complete, dispute family).
- **`facilitator` channel** — `performCancelVoucher`
  ([`facilitator-perform-action.ts:72`](../../src/harness/facilitator-perform-action.ts#L72))
  `POST`s straight to the facilitator's generic `/perform-action`. B7
  uses it precisely because the example server mounts **no** `/x402B/cancel`
  route — yet the action still completes, because the facilitator accepts
  any well-formed signed meta-tx and the `onchain`/facilitator paths don't
  depend on the seller's cooperation.

Both channels carry the **same** `signedPayload` (the ABI-encoded
`BosonMetaTx` from `client.signAction`) and land at the same Diamond
entrypoint; only the URL and the request envelope differ — compare the
server body `{ exchangeId, signedPayload }`
([`mount.ts:106`](../../../server-express/src/mount.ts#L106)) with the
facilitator body `{ action, exchangeId, network, escrowAddress, signedPayload }`
([`facilitator-perform-action.ts:110`](../../src/harness/facilitator-perform-action.ts#L110)).
The `onchain` fallback (the buyer submitting the meta-tx directly) is the
final guarantee and isn't a separate e2e scenario.

## Payload appendix

### `nextActions` envelope

The full envelope shape (channels, endpoints, `fallback.onchainHints`) is
specced in
[`boson-impl-04` § nextActions envelope](../../../../../docs/boson-impl-04-state-machine-and-next-actions.md).
The fields the D-series pins:

```jsonc
{
  "exchangeId": "13",
  "exchangeState": "COMMITTED",        // or "REDEEMED" after the redeem hop
  "next": [
    { "id": "boson-redeem",        "channels": ["server", "facilitator", "onchain"] },
    { "id": "boson-cancelVoucher", "channels": ["facilitator", "onchain"] }
    // … exactly clientLegalActions(exchangeState) …
  ],
  "fallback": {
    "onchainHints": {
      "escrow": "0x…",
      "metaTxEntrypoints": { "none": "executeMetaTransaction", "erc3009": "executeMetaTransactionWithTokenTransferAuthorization", … },
      "actionFacets": { "boson-redeem": "ExchangeHandlerFacet", … }
    }
  }
}
```

### Facilitator-channel request (B7)

```jsonc
// POST <facilitatorUrl>/perform-action
{ "action": "boson-cancelVoucher", "exchangeId": "13", "network": "eip155:31337", "escrowAddress": "0x…", "signedPayload": "0x…" }

// 200
{ "ok": true, "txHash": "0x…", "newExchangeState": "CANCELLED" }
```

## Code map

| Concern | Harness | SDK / server / facilitator |
|---|---|---|
| Derive legal transitions (server) | — | `deriveNextActions` ([`actions/src/derive.ts`](../../../actions/src/derive.ts)) → `clientLegalActions` ([`transitions.ts:98`](../../../core/src/state-machine/transitions.ts#L98)) |
| Read commit envelope (D1) | `readXPaymentResponse` | decodes `X-PAYMENT-RESPONSE` header |
| Read redeem envelope (D2) | `performBuyerPostCommitAction` → `result.nextActionIds` | `nextActions.next[]` in the response body |
| `server` channel | `performBuyerPostCommitAction` | `POST /x402B/<route>` → server relay → facilitator |
| `facilitator` channel | `performCancelVoucher` | `POST /perform-action` → `performAction` |
| `onchain` channel | — (buyer submits directly) | `metaTxEntrypoints` from `fallback.onchainHints` |

## Notes & gaps

- The suite asserts envelope **content** (D1/D2) and demonstrates **two
  usable channels** (server, facilitator) for post-commit actions. It does
  **not** yet drive an automatic server→facilitator→onchain **fallback on
  failure** end-to-end; that client-side `tryAllChannels`-style behaviour
  is the D3 scenario, parked in
  [`_skeletons.test.ts`](../../test/scenarios/_skeletons.test.ts).
- The `mcp` channel (D4) awaits `@bosonprotocol/x402-agent`; `xmtp` is
  advertised in `fallback` but not exercised.
- Channel ordering in `next[].channels` is the seller's *preferred* order;
  a client is free to override it (e.g. an agent that always prefers
  `onchain`). See
  [`boson-impl-04` § Channels](../../../../../docs/boson-impl-04-state-machine-and-next-actions.md).

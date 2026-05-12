# 07 — Facilitator

> **Status:** partial implementation (v0.1, 2026-05-04). `verify()` is implemented; `settle()` and `performAction()` remain relayer stubs.

## Goals

`@bosonprotocol/x402-facilitator` is the reference verify + settle + perform-action surface for the `escrow` scheme. It:

1. Exposes `/verify` and `/settle` endpoints compatible with x402's facilitator API, plus `/perform-action` for the `"facilitator"` `nextActions` channel.
2. Routes `escrow`-scheme payloads to the appropriate Boson on-chain entrypoint.
3. Submits transactions and pays gas.

Stateless w.r.t. funds; never custodies tokens. Stateful only for in-flight tx tracking and (optional) duplicate-submission protection.

## Endpoints

```
POST /verify
  body: { scheme: "escrow", network, payload, requirements }
  -> { ok: true } | { ok: false, code, reason }

POST /settle
  body: { scheme: "escrow", network, payload, requirements }
  -> { ok: true, exchangeId, txHash } | { ok: false, code, reason }

POST /perform-action?action=<ActionId>     // optional, for the "facilitator" channel in nextActions
  body: { network, escrowAddress, exchangeId, action, signedPayload }
  -> { ok: true, txHash, newExchangeState, newDisputeState? } | { ok: false, code, reason }

  `signedPayload` is the ABI-encoded tuple
    (address from, string functionName, bytes functionSignature,
     uint256 nonce, uint8 v, bytes32 r, bytes32 s)
  — a serialised `BosonMetaTx` ready to be wrapped in
  `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`.

  `newExchangeState` / `newDisputeState` are looked up from the static
  `ACTION_POST_STATE` table in `@bosonprotocol/x402-core/state-machine`
  so clients can update local state without a subgraph round-trip.
```

`FacilitatorChannelAdapter` stamps `endpoints.facilitator` with:

- `${url}/settle` for commit-time actions (`boson-createOfferAndCommit`, `boson-createOfferCommitAndRedeem`).
- `${url}/perform-action?action=${action}` for post-commit actions.

## Settle path

In v0.1, `verify()` performs structural validation, offer/calldata
consistency checks, signature recovery, token-auth constraints, and
simulation pre-flight. `settle()` and `performAction()` throw
`NotImplementedError` until the relayer implementation lands. The intended
submit path is selected by the buyer's `tokenAuthStrategy`.

For `tokenAuthStrategy = "none"`, the facilitator wraps the signed
meta-transaction with the existing Boson entrypoint:

```solidity
MetaTransactionsHandlerFacet.executeMetaTransaction(
  userAddress,
  functionName,
  functionSignature,
  nonce,
  packedSig
)
```

For `tokenAuthStrategy = "erc3009" | "permit" | "permit2"`, the planned
BPIP-12 path is:

```solidity
MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization(
  metaTxParams,                  // built from payload.metaTx
  tokenTransferAuthorizations,   // bytes[] queue, one entry encoding payload.tokenAuth
  r, s, v                        // payload.metaTx.sig
)
```

That BPIP-12 builder is currently represented by a throwing
`buildExecuteMetaTransactionWithTokenAuthTx` stub in `@bosonprotocol/x402-evm`.
Facilitator implementation should map that unsupported path to
`UNSUPPORTED_TOKEN_AUTH_STRATEGY` until the ABI support ships.

The inner `payload.metaTx.functionName` selects which protocol facet runs:

| `payload.action` | Inner function called by the meta-tx |
|---|---|
| `boson-createOfferAndCommit` | `ExchangeCommitFacet.createOfferAndCommit(fullOffer, creator, sellerSig, conditionalTokenId)` |
| `boson-createOfferCommitAndRedeem` | `OrchestrationHandlerFacet2.createOfferCommitAndRedeem(fullOffer, creator, sellerSig, conditionalTokenId)` |

The token-auth entry is encoded per BPIP-12's `TokenTransferAuthorizationLib` queue format. Strategy → encoder mapping:

| Strategy | Encoder produces |
|---|---|
| `none` | (empty queue) |
| `erc3009` | tag + ABI-encoded `(from, to, value, validAfter, validBefore, nonce, v, r, s)` |
| `permit` | tag + ABI-encoded `(owner, spender, value, deadline, v, r, s)` |
| `permit2` | tag + ABI-encoded Permit2 `PermitTransferFrom` + signature |

## Sections to write

- Exact byte layout of each `tokenTransferAuthorizations[i]` entry — pin against `TokenTransferAuthorizationLib` once PR #1104 finalizes.
- Gas estimation and per-network gas-price policy.
- Fee model: per-tx flat / percent / free.
- Nonce management for the facilitator's relayer wallet.
- Multi-chain routing.
- Operator authorization (none for v1 — facilitator is permissionless).
- Health-check, metrics, structured errors.
- Reference deployment (Sepolia + Base) for examples.

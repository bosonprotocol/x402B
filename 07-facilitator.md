# 07 — Facilitator

> **Status:** stub (v0.1, 2026-05-04). API surface only; details to be filled during implementation.

## Goals

`@bosonprotocol/x402-facilitator` is the reference verify + settle service for the `escrow` scheme. It:

1. Exposes `/verify` and `/settle` endpoints compatible with x402's facilitator API.
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

POST /perform-action     // optional, for the "facilitator" channel in nextActions
  body: { exchangeId, action, signedPayload }
  -> { ok: true, txHash } | { ok: false, code, reason }
```

## Settle path

Every `escrow` settle is the same single on-chain call:

```
MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization(
  metaTxParams,                  // built from payload.metaTx
  tokenTransferAuthorizations,   // bytes[] queue, one entry encoding payload.tokenAuth
                                 // (empty array when tokenAuthStrategy = "none")
  r, s, v                        // payload.metaTx.sig
)
```

The inner `metaTxParams.functionName` selects which protocol facet runs:

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

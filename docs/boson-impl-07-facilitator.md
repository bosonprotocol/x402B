# 07 — Facilitator

> **Status:** implemented library surface (v0.1, updated 2026-05-15). `verify()`, `settle()`, and `performAction()` are wired through the core-sdk meta-transaction path.

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
  body: {
    network, escrowAddress, exchangeId, action, signedPayload,
    // Required when tokenAuthStrategy !== "none"; omitted otherwise:
    tokenAuthStrategy?, tokenAuth?, asset?, amount?, maxTimeoutSeconds?
  }
  -> { ok: true, txHash, newExchangeState, newDisputeState? } | { ok: false, code, reason }

  `signedPayload` is the ABI-encoded tuple
    (address from, string functionName, bytes functionSignature,
     uint256 nonce, uint8 v, bytes32 r, bytes32 s)
  — a serialised `BosonMetaTx` ready to be wrapped in
  `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`.

  `newExchangeState` / `newDisputeState` are looked up from the static
  `ACTION_POST_STATE` table in `@bosonprotocol/x402-core/state-machine`
  so clients can update local state without a subgraph round-trip.

  Most post-commit actions are non-payable: `tokenAuthStrategy` defaults
  to `"none"` and the additional fields MUST be omitted. When
  `tokenAuthStrategy !== "none"`, `tokenAuth`, `asset`, `amount`, and
  `maxTimeoutSeconds` are all required. The facilitator recovers and
  cross-checks the token-auth signature before simulation/submission,
  then submits the BPIP-12 token-transfer-authorization envelope through
  core-sdk.
```

`FacilitatorChannelAdapter` stamps `endpoints.facilitator` with:

- `${url}/settle` for commit-time actions (`boson-createOfferAndCommit`, `boson-createOfferCommitAndRedeem`).
- `${url}/perform-action?action=${action}` for post-commit actions.

## Escrow allowlist

The facilitator operator MUST configure
`FacilitatorConfig.escrows: Record<EvmNetwork, Address>` — the set of
Boson Diamond addresses the relayer is willing to sponsor gas for.
`verify()`, `settle()`, and `performAction()` all reject requests for
networks without an allowlist entry, and reject requests whose
`escrowAddress` (in `requirements` for verify/settle, in the request
body for perform-action) doesn't match the configured Diamond.

Without this gate, anyone could direct the relayer at an arbitrary
contract on a supported chain that exposes a compatible
`executeMetaTransaction(...)` selector — the facilitator would become
a generic gas sponsor rather than a Boson-only relay.

## Submit path

`verify()` performs structural validation, offer/calldata consistency
checks, signature recovery, token-auth constraints, and simulation
pre-flight. `settle()` and `performAction()` then submit the signed
meta-transaction through `coreSdk.executeMetaTransaction(...)`. The
facilitator config provides a viem `WalletClient` (gas payer) and
`PublicClient` (simulation and receipt polling); the SDK receives them
through `@bosonprotocol/x402-evm/adapters`' viem-backed
`Web3LibAdapter`.

The submit path is selected by whether a non-empty
`transferAuthorizations` queue is supplied.

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

For `tokenAuthStrategy = "erc3009" | "permit" | "permit2"`, the
facilitator lifts `payload.tokenAuth` / `performAction.tokenAuth` into a
single-entry `transferAuthorizations` queue and core-sdk routes to the
BPIP-12 entrypoint:

```solidity
MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization(
  userAddress,
  functionName,
  functionSignature,
  nonce,
  packedSig,
  tokenTransferAuthorization     // ABI-encoded bytes[] queue
)
```

Simulation uses the same core-sdk handler helpers in `returnTxInfo: true`
mode to build `{ to, data }` for `eth_call`, so pre-flight and broadcast
calldata stay aligned.

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

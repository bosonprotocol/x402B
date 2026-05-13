# @bosonprotocol/x402-evm

EVM-specific calldata builders for the Boson Protocol [`escrow`](https://github.com/bosonprotocol/x402-escrow-schema)
scheme — the EVM half of the
[x402B](https://github.com/bosonprotocol/x402B) implementation.

See `docs/boson-impl-00-overview.md` in the monorepo root for context.

## Scope

This package ships **only** what the x402B escrow scheme needs beyond
what [`@bosonprotocol/core-sdk`](https://github.com/bosonprotocol/core-components)
already provides:

This release intentionally depends on `@bosonprotocol/core-sdk@1.47.1-alpha.0`.
That alpha is the first published SDK line used here that exposes
`signMetaTxCreateOfferAndCommit` on both `metaTx.handler` and `CoreSDK`.

| Subpath | Purpose |
|---|---|
| `./actions` | Inner-action ABI encoding for the commit step. `buildCreateOfferAndCommitCalldata` returns the `{ functionName, functionSignature }` pair that feeds the meta-tx typed-data the buyer signs. |
| `./envelope` | Outer meta-tx envelope. `buildExecuteMetaTransactionTx` encodes calldata for the existing `MetaTransactionsHandlerFacet.executeMetaTransaction(...)` entrypoint. |

That's the whole supported v0.1 surface. Two builders for primitives
that don't yet exist in core-sdk ship as **throwing stubs** —
`buildCreateOfferCommitAndRedeemCalldata` (Flow B, blocked on contracts
PR #1105) and `buildExecuteMetaTransactionWithTokenAuthTx` (BPIP-12).

## What this package deliberately does NOT ship

Boson's meta-tx and direct-call flows for every other action are
already fully covered by `@bosonprotocol/core-sdk`. Reach for it
directly:

### Meta-tx signing (default) — `coreSdk.signMetaTxXxx`

Each `signMetaTxXxx` method on a configured `CoreSDK` instance uses the
bespoke EIP-712 type the protocol's `MetaTransactionsHandlerFacet`
expects for that action family (`MetaTxExchange` for
`redeem/complete/cancel/revoke/raise/retract/escalate`,
`MetaTxDisputeResolution` for `resolveDispute`, generic
`MetaTransaction` for `createOfferAndCommit` and friends). It returns
`SignedMetaTx = { functionName, functionSignature, r, s, v }` — exactly
the buyer-side payload the `X-PAYMENT` header carries, ready for the
facilitator to wrap with `buildExecuteMetaTransactionTx`.

```ts
const signed = await coreSdk.signMetaTxRedeemVoucher({ nonce, exchangeId });
// signed = { functionName: "redeemVoucher(uint256)", functionSignature, r, s, v }
```

`coreSdk` fills `web3Lib`, `metaTxHandlerAddress`, and `chainId` from
the SDK instance, so the call site stays minimal. The standalone
`metaTx.handler.signMetaTxXxx` exports are also available if you need
them without a `CoreSDK` instance.

### Direct on-chain submission — `coreSdk.xxx`

For the on-chain channel (buyer paying their own gas, or the
"onchain" fallback in `nextActions[i].channels`), use the same `CoreSDK`
mixin methods that handle signing and submission in one call:

```ts
const tx = await coreSdk.redeemVoucher(exchangeId);
// → also: completeExchange, cancelVoucher, revokeVoucher,
//          raiseDispute, retractDispute, escalateDispute, resolveDispute
await tx.wait();
```

Pass `returnTxInfo: true` to get back a `TransactionRequest` for manual
submission (e.g. when handing it to a relayer or batcher) instead of
broadcasting through the SDK's `web3Lib`.

### Token-side `approve` / Permit2 approval

Calldata builders for the buyer's pre-approval transaction (used by
`tokenAuthStrategy: "none"`) and the one-time Permit2 contract approval
live in [`@bosonprotocol/x402-core`](../core):

```ts
import {
  createErc20ApprovalTx,
  createPermit2ApprovalTx,
} from "@bosonprotocol/x402-core/eip712/token-auth";
```

## Deferred — throws `NotYetSupportedError`

- `buildCreateOfferCommitAndRedeemCalldata` — atomic
  `OrchestrationHandlerFacet2.createOfferCommitAndRedeem` (Flow B in
  the spec, gated on Boson contracts PR #1105 and core-sdk shipping
  `signMetaTxCreateOfferCommitAndRedeem`).
- `buildExecuteMetaTransactionWithTokenAuthTx` — BPIP-12
  `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`
  envelope. Until BPIP-12 lands in `IBosonMetaTransactionsHandlerABI`,
  `tokenAuthStrategy: "none"` is the only supported strategy
  (buyer pre-approves the escrow via `createErc20ApprovalTx`).

`catch (e) { if (e instanceof NotYetSupportedError) … }` is the
recommended fallback shape.

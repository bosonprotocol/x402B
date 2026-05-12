# @bosonprotocol/x402-facilitator

Reference facilitator (verify / settle / perform-action relayer) for the
Boson Protocol [`escrow`](https://github.com/bosonprotocol/x402-escrow-schema)
scheme — the off-server gas-paying meta-transaction relayer in the
[x402B](https://github.com/bosonprotocol/x402B) implementation.

See [`docs/boson-impl-07-facilitator.md`](../../../docs/boson-impl-07-facilitator.md)
for the spec and [`docs/boson-impl-01-escrow-scheme.md`](../../../docs/boson-impl-01-escrow-scheme.md)
for the wire format.

## Status

**Skeleton.** This package currently ships only the public TypeScript
surface — input/result types, `FacilitatorConfig`, the
`FacilitatorErrorCode` union, and the `FacilitatorChannelAdapter` that
plugs into `@bosonprotocol/x402-actions`'s `ChannelAdapter` contract. The
three library functions (`verify`, `settle`, `performAction`) throw
`NotImplementedError`; real implementations land in follow-up PRs.

## What it does

Library-shaped facilitator. Three async functions mirror the wire-level
endpoints described in `docs/boson-impl-07-facilitator.md`:

```
verify(input, config)         -> { ok }              | { ok: false, code, reason }
settle(input, config)         -> { ok, exchangeId, txHash } | { ok: false, code, reason }
performAction(input, config)  -> { ok, txHash, newExchangeState, newDisputeState? }
                              |  { ok: false, code, reason }
```

The buyer signs the inner action calldata + outer meta-tx envelope on
the client side (typically via `@bosonprotocol/core-sdk`'s
`signMetaTxXxx` helpers — see `@bosonprotocol/x402-evm`'s README for the
client-side pattern). The facilitator never re-builds calldata — it
accepts `payload.metaTx.functionName` and `payload.metaTx.functionSignature`
straight from the request and passes them through to
`@bosonprotocol/x402-evm/envelope`'s `buildExecuteMetaTransactionTx`.

The facilitator's responsibilities are:

1. **Validate** — structural shape, scheme/network/action match, signature
   recovery, on-chain simulation pre-flight.
2. **Submit** — wrap the buyer's signed meta-tx in
   `MetaTransactionsHandlerFacet.executeMetaTransaction(...)`, send via
   the configured viem `WalletClient`, await the receipt.
3. **Relay post-commit transitions** — same envelope, same submit path,
   for `redeem` / `complete` / `cancel` / `revoke` / `raise` / `retract` /
   `escalate` / `resolve` dispute.

## Install

```sh
pnpm add @bosonprotocol/x402-facilitator @bosonprotocol/x402-core @bosonprotocol/x402-actions
```

## API

```ts
import {
  verify,
  settle,
  performAction,
  FacilitatorChannelAdapter,
  type FacilitatorConfig,
} from "@bosonprotocol/x402-facilitator";

// v0.1: these throw NotImplementedError. Wire-format hints below are
// stable; the implementation lands in follow-up PRs.
```

## The `facilitator` channel

`FacilitatorChannelAdapter` implements `@bosonprotocol/x402-actions`'s
`ChannelAdapter` for the `"facilitator"` channel. Plug it into a server
SDK's `ChannelRegistry` to stamp `endpoints.facilitator` into every
`nextActions[]` entry the facilitator can carry.

```ts
import { FacilitatorChannelAdapter } from "@bosonprotocol/x402-facilitator/channels/facilitator";

const adapter = new FacilitatorChannelAdapter();
adapter.describe("boson-redeem", { url: "https://facilitator.example" });
// -> { endpoint: "https://facilitator.example/perform-action?action=boson-redeem" }
```

## License

Apache-2.0.

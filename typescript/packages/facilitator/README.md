# @bosonprotocol/x402-facilitator

Reference facilitator (verify / settle / perform-action relayer) for the
Boson Protocol [`escrow`](https://github.com/bosonprotocol/x402-escrow-schema)
scheme — the off-server gas-paying meta-transaction relayer in the
[x402B](https://github.com/bosonprotocol/x402B) implementation.

See [`docs/boson-impl-07-facilitator.md`](../../../docs/boson-impl-07-facilitator.md)
for the spec and [`docs/boson-impl-01-escrow-scheme.md`](../../../docs/boson-impl-01-escrow-scheme.md)
for the wire format.

## Status

**Partial implementation.** This package ships the public TypeScript
surface, `FacilitatorChannelAdapter`, and an implemented `verify()`
pre-flight path. `settle()` and `performAction()` still throw
`NotImplementedError`; relayer submission lands in follow-up PRs.

## What it does

Library-shaped facilitator. Three async functions mirror the wire-level
endpoints described in `docs/boson-impl-07-facilitator.md`:

```text
verify(input, config)         -> { ok }              | { ok: false, code, reason }
settle(input, config)         -> { ok, exchangeId, txHash } | { ok: false, code, reason }
performAction(input, config)  -> { ok, txHash, newExchangeState, newDisputeState? }
                              |  { ok: false, code, reason }
```

The buyer signs the inner action calldata + outer meta-tx envelope on
the client side (typically via `@bosonprotocol/core-sdk`'s
`signMetaTxXxx` helpers — see `@bosonprotocol/x402-evm`'s README for the
client-side pattern). `verify()` re-builds the expected commit-time
calldata only to confirm `payload.metaTx.functionName` and
`payload.metaTx.functionSignature` match the advertised offer; submission
still passes the buyer-signed calldata through to the meta-tx envelope.

The facilitator's responsibilities are:

1. **Validate** — structural shape, scheme/network/action match, signature
   recovery, offer/calldata consistency, token-auth constraints, and
   on-chain simulation pre-flight.
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

// v0.1: verify() is implemented; settle() and performAction() throw
// NotImplementedError until relayer submission lands.
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

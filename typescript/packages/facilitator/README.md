# @bosonprotocol/x402-facilitator

Reference facilitator (verify / settle / perform-action relayer) for the
Boson Protocol [`escrow`](https://github.com/bosonprotocol/x402-escrow-schema)
scheme — the off-server gas-paying meta-transaction relayer in the
[x402B](https://github.com/bosonprotocol/x402B) implementation.

See [`docs/boson-impl-07-facilitator.md`](../../../docs/boson-impl-07-facilitator.md)
for the spec and [`docs/boson-impl-01-escrow-scheme.md`](../../../docs/boson-impl-01-escrow-scheme.md)
for the wire format.

## Status

**Functional for `tokenAuthStrategy: "none"`.** All three library
functions (`verify`, `settle`, `performAction`) are wired up:

- `verify()` — structural validation, EIP-712 signature recovery for
  the buyer's meta-tx and (for non-`"none"`) the token-auth payload,
  plus an on-chain `eth_call` simulation pre-flight.
- `settle()` — calls `verify`, builds the
  `executeMetaTransaction(...)` envelope via `@bosonprotocol/x402-evm`,
  submits via the configured `WalletClient`, awaits the receipt, and
  extracts `exchangeId` from the `BuyerCommitted` event.
- `performAction()` — same envelope + submit path for the eight
  post-commit transitions (redeem / complete / cancel / revoke / raise
  / retract / escalate / resolve dispute); returns the predicted
  `newExchangeState` / `newDisputeState` from the static
  `ACTION_POST_STATE` table so callers can update local state without a
  subgraph round-trip.

The BPIP-12 token-auth queue path (`erc3009` / `permit` / `permit2`)
surfaces as `UNSUPPORTED_TOKEN_AUTH_STRATEGY` until
`@bosonprotocol/x402-evm` ships the encoder. The atomic
`boson-createOfferCommitAndRedeem` action is similarly blocked.

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

const config: FacilitatorConfig = {
  url: "https://facilitator.example",
  supportedNetworks: ["eip155:1"],
  // Server-side allowlist of trusted Boson Diamonds. `performAction()`
  // rejects requests for unknown networks or for `escrowAddress`
  // values that don't match the configured Diamond — prevents the
  // facilitator from being abused as a generic gas sponsor for
  // arbitrary contracts.
  escrows: { "eip155:1": "0xBosonDiamondAddress…" },
  walletClient, // viem WalletClient — relayer pays gas
  publicClient, // viem PublicClient — used for eth_call + receipt waits
};

const verifyResult = await verify(
  { scheme: "escrow", network: "eip155:1", payload, requirements },
  config,
);
const settleResult = await settle(
  { scheme: "escrow", network: "eip155:1", payload, requirements },
  config,
);
const actionResult = await performAction(
  {
    network: "eip155:1",
    escrowAddress: "0x…",
    exchangeId: "42",
    action: "boson-redeem",
    signedPayload, // ABI-encoded BosonMetaTx, see encodeSignedPayload()
  },
  config,
);
```

`signedPayload` for `performAction` is the ABI-encoded tuple
`(address from, string functionName, bytes functionSignature,
uint256 nonce, uint8 v, bytes32 r, bytes32 s)` — i.e. a serialised
`BosonMetaTx`. The package exports `encodeSignedPayload` and
`decodeSignedPayload` helpers so client SDKs can share the codec.

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

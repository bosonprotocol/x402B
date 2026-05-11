---
"@bosonprotocol/x402-fulfillment": minor
---

Add `FulfillmentRegistry` (server-side): owns configured channel
instances keyed by id, dispatches `validate` / `onCommit` / `onFulfill`,
and produces the `FulfillmentOption[]` list for
`PaymentRequirements.fulfillment.options`. Exposed via the `./registry`
subpath. Duplicate-id registration throws `DuplicateChannelError`;
dispatch against an unknown id throws `UnknownChannelError`.

Aligns the channel-interface method names with the upstream
`x402-escrow-schema` spec — `onRedeem` → `onFulfill` and the
`FulfillmentResult` discriminator `"atomic"` → `"inline"` in
`src/types.ts`.

Drops the `FulfillmentOptionDescriptor` alias; channels now return
the wire-format `FulfillmentOption` directly from `describe()` since
`metadata` is already part of `FulfillmentOption` on
`@bosonprotocol/x402-core`. `buyerDataSchema` is retyped to
`Record<string, unknown> | null` (same as `FulfillmentOption.schema`),
removing the previous `JSONSchema7` casts and the `@types/json-schema`
devDep.

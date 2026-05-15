---
"@bosonprotocol/x402-server": patch
---

Distinguish facilitator domain rejections from transport failures in
`createFacilitatorClient`. When a non-2xx response carries a parseable
`{ok:false, code, reason}` body (as `facilitator-express` emits for
domain failures over HTTP 400), the client now returns it as the typed
domain result instead of throwing `FacilitatorHttpError`. Transport
faults (network error, non-JSON body, schema-mismatched body) still
throw `FacilitatorHttpError`. The convenience handlers'
`FACILITATOR_REJECTED` branch is now exercised for legitimate
facilitator rejections like `BAD_META_TX_SIGNATURE` instead of
masking them as `FACILITATOR_UNREACHABLE`.

---
"@bosonprotocol/x402-server": patch
---

Distinguish facilitator domain rejections from transport failures in
`createFacilitatorClient`. When an HTTP 400 response carries a parseable
`{ok:false, code, reason}` body (as `facilitator-express` emits for
domain failures), the client now returns it as the typed domain result
instead of throwing `FacilitatorHttpError`. Transport faults (network
error, non-JSON body, schema-mismatched body, or 5xx response) still
throw `FacilitatorHttpError`. The convenience handlers'
`FACILITATOR_REJECTED` branch is now exercised for legitimate
facilitator rejections like `BAD_META_TX_SIGNATURE` instead of masking
them as `FACILITATOR_UNREACHABLE`.

---
"@bosonprotocol/x402-client": patch
---

Fix `parsePaymentResponse` to read and normalize the nested
`nextActions.exchangeState` (and `nextActions.disputeState` when present)
from the `X-PAYMENT-RESPONSE` header. The server emits exchange state under
the nested path, so the prior top-level-only lookup always returned an
undefined `summary.state`. Top-level `state` still wins when present.

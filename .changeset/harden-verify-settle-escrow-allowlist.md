---
"@bosonprotocol/x402-facilitator": minor
---

Extend the `FacilitatorConfig.escrows` allowlist enforcement to
`verify()` and `settle()`. Previously only `performAction()` validated
the target Diamond against the operator-configured allowlist;
`verify()`/`settle()` trusted `input.requirements.escrowAddress`
directly, so a malicious seller could direct the relayer at any
contract on a supported chain that exposes a compatible
`executeMetaTransaction(...)` selector.

`verify()` (and transitively `settle()`) now reject:
- Networks with no `config.escrows[network]` entry →
  `NETWORK_MISMATCH`.
- `requirements.escrowAddress` mismatched against the configured
  Diamond → `INVALID_PAYLOAD`.

Spec doc and `FacilitatorConfig.escrows` JSDoc updated to reflect that
all three library functions now consume the same allowlist.

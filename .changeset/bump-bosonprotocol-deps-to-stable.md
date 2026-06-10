---
"@bosonprotocol/x402-core": patch
"@bosonprotocol/x402-evm": patch
"@bosonprotocol/x402-client": patch
"@bosonprotocol/x402-facilitator": patch
"@bosonprotocol/x402-server": patch
---

Bump `@bosonprotocol/core-sdk` (1.48.0-alpha.6 → 1.48.0) and
`@bosonprotocol/common` (1.33.0-alpha.7 → 1.33.0) off the pre-release lines to
their stable releases, so consumers of `@bosonprotocol/x402-*` resolve the
matching stable peer chain (PR #113).

This changeset is added retroactively: PR #113 merged without one, leaving the
*latest* release flow with nothing to consume.

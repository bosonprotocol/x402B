---
"@bosonprotocol/x402-core": patch
"@bosonprotocol/x402-evm": patch
"@bosonprotocol/x402-client": patch
"@bosonprotocol/x402-facilitator": patch
"@bosonprotocol/x402-server": patch
---

Bump `@bosonprotocol/core-sdk` (1.48.0 → 1.48.2) and `@bosonprotocol/common`
(1.33.0 → 1.35.0) to the current stable releases, so consumers of
`@bosonprotocol/x402-*` resolve the matching peer chain. The two move together:
core-sdk 1.48.2 requires `@bosonprotocol/common@^1.35.0`.

No API surface change. `core-sdk`'s `dist` is byte-identical between 1.48.0 and
1.48.2, and in `common` the `abis` export that `x402-facilitator` encodes
calldata against is unchanged — the release only moves Base ahead of Polygon in
the env config lists, repoints the subgraph URLs to Goldsky, and repoints the
IPFS metadata upload endpoint to Pinata, none of which this workspace consumes.

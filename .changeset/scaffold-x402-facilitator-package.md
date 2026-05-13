---
"@bosonprotocol/x402-facilitator": minor
---

Initial skeleton for `@bosonprotocol/x402-facilitator`: ships I/O types
(`FacilitatorVerifyInput/Result`, `FacilitatorSettleInput/Result`,
`FacilitatorPerformActionInput/Result`), `FacilitatorConfig`, the
`FacilitatorErrorCode` union, the typed `FacilitatorError` /
`NotImplementedError` classes with a `toResult()` normalizer, and the
`FacilitatorChannelAdapter` implementation of
`@bosonprotocol/x402-actions`'s `ChannelAdapter` for the `facilitator`
channel. The three library functions (`verify`, `settle`,
`performAction`) are stubs that throw `NotImplementedError` until the
real implementations land in follow-up PRs.

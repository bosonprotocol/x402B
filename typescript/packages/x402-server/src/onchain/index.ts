// `onchain` subpath — post-settle state verification. Pure
// comparison logic + a pluggable `ExchangeReader` interface so
// callers can wire subgraph / RPC / core-sdk readers without
// x402-server depending on any one mechanism.

export {
  verifyExchange,
  verifyExchangeSnapshot,
  type ExchangeReader,
  type ExchangeSnapshot,
  type VerifyExchangeErrorCode,
  type VerifyExchangeExpected,
  type VerifyExchangeResult,
} from "./verify-exchange.js";

// Public surface for `@bosonprotocol/x402-evm/adapters`.
//
// Adapters bridge viem clients to the `Web3LibAdapter` contract that
// `@bosonprotocol/core-sdk`'s `CoreSDK` consumes. The relayer variant
// drives writes through a viem `WalletClient` and reads through a
// `PublicClient`; it surfaces submission failures as a tagged
// `RelayerSubmitError` so callers can preserve precise error codes.

export {
  walletClientToWeb3LibAdapter,
  classifyViemSendError,
  RelayerSubmitError,
  type RelayerSubmitErrorCode,
} from "./viem-relayer.js";

// Calldata-only stub adapter — needed by callers that route through
// core-sdk handler-level helpers in `returnTxInfo: true` mode (e.g. for
// simulation `eth_call` precursors) where no signer or transport is
// required. Lives under `internal/` because the calldata-builder modules
// in this package consume it directly; re-exposed here so external
// callers (the facilitator's simulate path) don't have to deep-import.
export { createCalldataOnlyWeb3LibAdapter } from "../internal/web3lib-stub.js";

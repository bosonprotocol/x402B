// Single source of truth for the Boson post-commit action ABIs the
// facilitator validates and recovers signatures against. Combines the
// three relevant facet ABIs from `@bosonprotocol/common` so callers can
// pass one constant to viem's `decodeFunctionData` and match by 4-byte
// selector across the union — no hand-rolled `parseAbi` strings.
//
//   - redeem / cancel / revoke / completeExchange     → ExchangeHandler
//   - raise / resolve / escalate / retractDispute     → DisputeHandler
//   - withdrawFunds                                   → FundsHandler

import { abis } from "@bosonprotocol/common";

export const BOSON_POST_COMMIT_ACTION_ABI = [
  ...(abis.IBosonExchangeHandlerABI as readonly unknown[]),
  ...(abis.IBosonDisputeHandlerABI as readonly unknown[]),
  ...(abis.IBosonFundsHandlerABI as readonly unknown[]),
] as const satisfies readonly unknown[];

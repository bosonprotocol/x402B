// `handlers` subpath — pure, framework-agnostic convenience
// handlers for the post-402 actions. Each handler is awaitable and
// returns the discriminated `HandlerResult<TBody>` (or
// `PlainHandlerResult<TBody>` for entity-keyed actions that don't
// emit `nextActions`); the `@bosonprotocol/x402-server-express`
// adapter (and others) map that result to HTTP status + JSON body.

export {
  handleCommit,
  handleCommitAndRedeem,
  type CommitHandlerContext,
  type CommitHandlerInput,
  type CommitOk,
} from "./commit-and-redeem.js";
export {
  handlePerformAction,
  handleComplete,
  handleDisputeEscalate,
  handleDisputeRaise,
  handleDisputeResolve,
  handleDisputeRetract,
  handleRedeem,
  type PerformActionContext,
  type PerformActionInput,
  type PerformActionOk,
  type RedeemHandlerContext,
  type RedeemHandlerInput,
} from "./perform-action.js";
export {
  handleWithdrawFunds,
  type WithdrawFundsContext,
  type WithdrawFundsInput,
  type WithdrawFundsOk,
} from "./withdraw-funds.js";
export {
  handleGetAvailableFunds,
  type AvailableFundsBody,
  type AvailableFundsContext,
  type AvailableFundsEntry,
  type AvailableFundsQuery,
} from "./available-funds.js";
export {
  resolveEntityId,
  type ResolveEntityError,
  type ResolveEntityInput,
  type ResolveEntityOk,
  type ResolveEntityResult,
} from "./resolve-entity.js";
export { emitNextActions, type EmitNextActionsInput } from "./next-actions.js";
export {
  handlerErr,
  handlerOk,
  plainHandlerOk,
  type HandlerErrorBody,
  type HandlerResult,
  type HandlerStatus,
  type HandlerWarning,
  type PlainHandlerResult,
} from "./types.js";

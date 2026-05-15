// `handlers` subpath — pure, framework-agnostic convenience
// handlers for the post-402 actions. Each handler is awaitable and
// returns the discriminated `HandlerResult<TBody>` shape; the
// `@bosonprotocol/x402-server-express` adapter (and others) map that
// result to HTTP status + JSON body.

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
export { emitNextActions, type EmitNextActionsInput } from "./next-actions.js";
export {
  handlerErr,
  handlerOk,
  type HandlerErrorBody,
  type HandlerResult,
  type HandlerStatus,
  type HandlerWarning,
} from "./types.js";

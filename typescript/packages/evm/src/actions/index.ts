// Public surface for `@bosonprotocol/x402-evm/actions`.
//
// Inner-action calldata builders for the commit step of the `escrow`
// scheme. The result feeds `@bosonprotocol/x402-core/eip712`'s
// `metaTransactionTypedData` to produce the EIP-712 typed-data the buyer
// signs.
//
// Two commit-time actions are supported:
//   - `boson-createOfferAndCommit` (Flow A, deferred redeem) via
//     `buildCreateOfferAndCommitCalldata`.
//   - `boson-createOfferCommitAndRedeem` (Flow B, atomic commit+redeem)
//     via `buildCreateOfferCommitAndRedeemCalldata`.
//
// Post-commit transitions (redeem / complete / cancel / revoke / raise /
// retract / escalate / resolve) are intentionally absent: every one is
// already covered by `@bosonprotocol/core-sdk`'s
// `metaTx.handler.signMetaTxXxx` (meta-tx path, each with its own
// custom EIP-712 type) and `exchanges.iface.encode*` / disputes-ABI
// (direct-call path). See the package README for the recommended call
// patterns.

export type { InnerActionCalldata, TxRequest } from "../types.js";

export {
  buildCreateOfferAndCommitCalldata,
  type BuildCreateOfferAndCommitCalldataArgs,
} from "./create-offer-and-commit.js";

export {
  buildCreateOfferCommitAndRedeemCalldata,
  type BuildCreateOfferCommitAndRedeemCalldataArgs,
} from "./create-offer-commit-and-redeem.js";

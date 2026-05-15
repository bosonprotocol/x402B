import { describe, expectTypeOf, it } from "vitest";

import {
  type ActionId,
  type FacilitatorErrorCode,
  type FacilitatorPerformActionInput,
  type FacilitatorPerformActionResult,
  type FacilitatorSettleResult,
  type FacilitatorVerifyResult,
  DisputeState,
  ExchangeState,
} from "../src/index.js";

describe("@bosonprotocol/x402-facilitator public types", () => {
  it("FacilitatorVerifyResult is a discriminated union on `ok`", () => {
    type Failure = Extract<FacilitatorVerifyResult, { ok: false }>;
    expectTypeOf<Failure["code"]>().toEqualTypeOf<FacilitatorErrorCode>();
    expectTypeOf<Failure["reason"]>().toEqualTypeOf<string>();

    type Success = Extract<FacilitatorVerifyResult, { ok: true }>;
    // Success branch must not expose `code` / `reason` / `txHash`.
    expectTypeOf<Success>().toEqualTypeOf<{ ok: true }>();
  });

  it("FacilitatorSettleResult success carries exchangeId + txHash", () => {
    type Success = Extract<FacilitatorSettleResult, { ok: true }>;
    expectTypeOf<Success["exchangeId"]>().toEqualTypeOf<string>();
    expectTypeOf<Success["txHash"]>().toEqualTypeOf<string>();
  });

  it("FacilitatorPerformActionInput.action is exactly the ActionId union", () => {
    expectTypeOf<FacilitatorPerformActionInput["action"]>().toEqualTypeOf<ActionId>();
  });

  it("FacilitatorPerformActionResult success carries the predicted new state", () => {
    type Success = Extract<FacilitatorPerformActionResult, { ok: true }>;
    expectTypeOf<Success["newExchangeState"]>().toEqualTypeOf<ExchangeState>();
    expectTypeOf<Success["newDisputeState"]>().toEqualTypeOf<DisputeState | undefined>();
  });

  it("exhaustive switch on FacilitatorErrorCode compiles", () => {
    // The point of this test is that this function is type-checked: if a
    // new code is added to the union without updating the switch, the
    // `assertNever` line below stops compiling. Run-time behaviour is
    // irrelevant — vitest type tests are compiled, not executed.
    function _assertExhaustive(code: FacilitatorErrorCode): string {
      switch (code) {
        case "INVALID_PAYLOAD":
        case "SCHEME_MISMATCH":
        case "NETWORK_MISMATCH":
        case "BAD_META_TX_SIGNATURE":
        case "BAD_TOKEN_AUTH_SIGNATURE":
        case "UNSUPPORTED_ACTION":
        case "UNSUPPORTED_TOKEN_AUTH_STRATEGY":
        case "ACTION_NOT_IN_REQUIREMENTS":
        case "TOKEN_AUTH_NOT_IN_REQUIREMENTS":
        case "SIMULATION_REVERT":
        case "INSUFFICIENT_FUNDS_FOR_GAS":
        case "ONCHAIN_REVERT":
        case "EVENT_NOT_FOUND":
        case "INTERNAL_ERROR":
          return code;
        default: {
          const _exhaustive: never = code;
          return _exhaustive;
        }
      }
    }
    expectTypeOf(_assertExhaustive).toBeFunction();
  });
});

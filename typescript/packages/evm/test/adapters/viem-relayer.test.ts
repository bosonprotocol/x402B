import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  RawContractError,
} from "viem";

import { classifyViemSendError, RelayerSubmitError } from "../../src/adapters/viem-relayer.js";

describe("classifyViemSendError", () => {
  it("maps a direct InsufficientFundsError to INSUFFICIENT_FUNDS_FOR_GAS", () => {
    const err = classifyViemSendError(new InsufficientFundsError());
    expect(err).toBeInstanceOf(RelayerSubmitError);
    expect(err.code).toBe("INSUFFICIENT_FUNDS_FOR_GAS");
  });

  it("maps a BaseError wrapping InsufficientFundsError to INSUFFICIENT_FUNDS_FOR_GAS", () => {
    const wrapped = new BaseError("wrapped", { cause: new InsufficientFundsError() });
    const err = classifyViemSendError(wrapped);
    expect(err.code).toBe("INSUFFICIENT_FUNDS_FOR_GAS");
  });

  it("maps an ExecutionRevertedError to ONCHAIN_REVERT", () => {
    const err = classifyViemSendError(new ExecutionRevertedError({ message: "reverted" }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("maps a BaseError wrapping ContractFunctionRevertedError to ONCHAIN_REVERT", () => {
    const inner = new ContractFunctionRevertedError({
      abi: [],
      functionName: "foo",
    });
    const err = classifyViemSendError(new BaseError("wrapped", { cause: inner }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("maps a BaseError wrapping RawContractError to ONCHAIN_REVERT", () => {
    const inner = new RawContractError({ message: "execution reverted: foo" });
    const err = classifyViemSendError(new BaseError("wrapped", { cause: inner }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("falls back to INTERNAL_ERROR for arbitrary errors", () => {
    const err = classifyViemSendError(new Error("RPC unreachable"));
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toContain("RPC unreachable");
  });
});

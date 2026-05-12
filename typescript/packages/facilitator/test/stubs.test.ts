import { describe, expect, it } from "vitest";

import {
  NotImplementedError,
  performAction,
  settle,
  verify,
  type FacilitatorConfig,
  type FacilitatorPerformActionInput,
  type FacilitatorSettleInput,
  type FacilitatorVerifyInput,
} from "../src/index.js";

// The v0.1 stubs never read these inputs — they throw immediately. Cast
// through unknown so the test doesn't drag the full viem WalletClient /
// PublicClient surface into a contract that's checked elsewhere.
const dummyConfig = {} as unknown as FacilitatorConfig;
const dummyVerifyInput = {} as unknown as FacilitatorVerifyInput;
const dummySettleInput = {} as unknown as FacilitatorSettleInput;
const dummyPerformActionInput = {} as unknown as FacilitatorPerformActionInput;

describe("v0.1 stubs throw NotImplementedError", () => {
  it("verify() rejects with NotImplementedError and code NOT_IMPLEMENTED", async () => {
    const promise = verify(dummyVerifyInput, dummyConfig);
    await expect(promise).rejects.toBeInstanceOf(NotImplementedError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("settle() rejects with NotImplementedError and code NOT_IMPLEMENTED", async () => {
    const promise = settle(dummySettleInput, dummyConfig);
    await expect(promise).rejects.toBeInstanceOf(NotImplementedError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("performAction() rejects with NotImplementedError and code NOT_IMPLEMENTED", async () => {
    const promise = performAction(dummyPerformActionInput, dummyConfig);
    await expect(promise).rejects.toBeInstanceOf(NotImplementedError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

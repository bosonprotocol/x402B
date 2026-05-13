import { describe, expect, it } from "vitest";

import {
  NotImplementedError,
  performAction,
  settle,
  type FacilitatorConfig,
  type FacilitatorPerformActionInput,
  type FacilitatorSettleInput,
} from "../src/index.js";

// settle() and performAction() remain stubs in this commit — they throw
// NotImplementedError until later commits wire them up. Cast through
// unknown so the test doesn't drag the full viem WalletClient /
// PublicClient surface into a contract that's checked elsewhere.
const dummyConfig = {} as unknown as FacilitatorConfig;
const dummySettleInput = {} as unknown as FacilitatorSettleInput;
const dummyPerformActionInput = {} as unknown as FacilitatorPerformActionInput;

describe("v0.1 stubs throw NotImplementedError", () => {
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

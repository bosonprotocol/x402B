import { describe, expect, it } from "vitest";

import {
  NotImplementedError,
  performAction,
  type FacilitatorConfig,
  type FacilitatorPerformActionInput,
} from "../src/index.js";

// performAction() remains a stub in this commit — it throws
// NotImplementedError until the next commit wires up the dispatch. Cast
// through unknown so the test doesn't drag the full viem WalletClient /
// PublicClient surface into a contract that's checked elsewhere.
const dummyConfig = {} as unknown as FacilitatorConfig;
const dummyPerformActionInput = {} as unknown as FacilitatorPerformActionInput;

describe("v0.1 stubs throw NotImplementedError", () => {
  it("performAction() rejects with NotImplementedError and code NOT_IMPLEMENTED", async () => {
    const promise = performAction(dummyPerformActionInput, dummyConfig);
    await expect(promise).rejects.toBeInstanceOf(NotImplementedError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

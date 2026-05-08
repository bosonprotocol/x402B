import { describe, expect, it } from "vitest";

import { DisputeState, ExchangeState, PRE_COMMIT } from "../../src/state-machine/index.js";

describe("State enums sourced from core-sdk", () => {
  it("ExchangeState carries the 6 protocol values with CANCELLED spelling", () => {
    expect(ExchangeState.CANCELLED).toBe("CANCELLED");
    expect(ExchangeState.COMMITTED).toBe("COMMITTED");
    expect(ExchangeState.COMPLETED).toBe("COMPLETED");
    expect(ExchangeState.DISPUTED).toBe("DISPUTED");
    expect(ExchangeState.REDEEMED).toBe("REDEEMED");
    expect(ExchangeState.REVOKED).toBe("REVOKED");
  });

  it("DisputeState is a separate enum tracking the dispute sub-state machine", () => {
    expect(DisputeState.RESOLVING).toBe("RESOLVING");
    expect(DisputeState.RESOLVED).toBe("RESOLVED");
    expect(DisputeState.ESCALATED).toBe("ESCALATED");
    expect(DisputeState.RETRACTED).toBe("RETRACTED");
    expect(DisputeState.DECIDED).toBe("DECIDED");
    expect(DisputeState.REFUSED).toBe("REFUSED");
  });

  it("PRE_COMMIT is the synthetic pre-exchange marker", () => {
    expect(PRE_COMMIT).toBe("PRE_COMMIT");
  });
});

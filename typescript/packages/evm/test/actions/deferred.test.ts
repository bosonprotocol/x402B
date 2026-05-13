import { describe, expect, it } from "vitest";

import { buildCreateOfferCommitAndRedeemCalldata } from "../../src/actions/deferred-create-offer-commit-and-redeem.js";
import { NotYetSupportedError } from "../../src/errors.js";

describe("buildCreateOfferCommitAndRedeemCalldata (deferred)", () => {
  it("throws NotYetSupportedError with the builder name", () => {
    let err: unknown;
    try {
      // Args shape is irrelevant — the stub throws before reading them.
      buildCreateOfferCommitAndRedeemCalldata({} as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotYetSupportedError);
    expect((err as NotYetSupportedError).builder).toBe("buildCreateOfferCommitAndRedeemCalldata");
    expect((err as NotYetSupportedError).name).toBe("NotYetSupportedError");
  });
});

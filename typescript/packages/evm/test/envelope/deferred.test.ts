import { describe, expect, it } from "vitest";

import { buildExecuteMetaTransactionWithTokenAuthTx } from "../../src/envelope/deferred-execute-with-token-auth.js";
import { NotYetSupportedError } from "../../src/errors.js";

describe("buildExecuteMetaTransactionWithTokenAuthTx (deferred)", () => {
  it("throws NotYetSupportedError with the builder name", () => {
    let err: unknown;
    try {
      buildExecuteMetaTransactionWithTokenAuthTx({} as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotYetSupportedError);
    expect((err as NotYetSupportedError).builder).toBe(
      "buildExecuteMetaTransactionWithTokenAuthTx",
    );
  });
});

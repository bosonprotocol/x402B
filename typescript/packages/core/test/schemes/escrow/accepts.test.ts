import { describe, expect, it } from "vitest";

import { findEscrowAccept } from "../../../src/schemes/escrow/index.js";

describe("findEscrowAccept", () => {
  it("returns the escrow entry from a multi-scheme accepts[]", () => {
    const escrow = { scheme: "escrow", amount: "1000000" };
    const body = { x402Version: 2, accepts: [{ scheme: "exact" }, escrow] };
    expect(findEscrowAccept(body)).toBe(escrow);
  });

  it("returns undefined when no entry carries scheme 'escrow'", () => {
    const body = { x402Version: 2, accepts: [{ scheme: "exact" }, { scheme: "upto" }] };
    expect(findEscrowAccept(body)).toBeUndefined();
  });

  it.each([
    ["a non-object body", "not json"],
    ["null", null],
    ["a body without accepts[]", { x402Version: 2 }],
    ["a body whose accepts is not an array", { accepts: { scheme: "escrow" } }],
  ])("returns undefined for %s", (_label, body) => {
    expect(findEscrowAccept(body)).toBeUndefined();
  });

  it("skips non-object accepts[] entries without throwing", () => {
    const escrow = { scheme: "escrow" };
    const body = { accepts: [null, "x", 42, escrow] };
    expect(findEscrowAccept(body)).toBe(escrow);
  });
});

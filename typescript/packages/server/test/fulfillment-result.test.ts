// Unit coverage for the `serializeFulfillmentResult` wire helper.
// The handler-level tests cover the `async` branch end-to-end; here we
// pin the `inline` branch's base64 / contentType contract directly so a
// future refactor of the encoder can't drift the public response shape.

import { describe, expect, it } from "vitest";

import { serializeFulfillmentResult } from "../src/handlers/fulfillment-result.js";

describe("serializeFulfillmentResult — inline branch", () => {
  it("base64-encodes the raw body and passes the contentType through", () => {
    const body = new TextEncoder().encode("hello, buyer");
    const result = serializeFulfillmentResult({
      kind: "inline",
      body,
      contentType: "text/plain; charset=utf-8",
    });
    expect(result).toEqual({
      kind: "inline",
      body: Buffer.from("hello, buyer", "utf8").toString("base64"),
      contentType: "text/plain; charset=utf-8",
    });
    // `aGVsbG8sIGJ1eWVy` is the canonical base64 for "hello, buyer" —
    // pin it literally so a switch to e.g. base64url would fail loudly.
    if (result.kind === "inline") {
      expect(result.body).toBe("aGVsbG8sIGJ1eWVy");
    }
  });

  it("preserves arbitrary binary bytes round-trip", () => {
    // Non-UTF8 bytes (0x00, 0xff, 0x80) confirm the encoder isn't
    // silently going through a string conversion.
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff, 0xfe]);
    const result = serializeFulfillmentResult({
      kind: "inline",
      body: bytes,
      contentType: "application/octet-stream",
    });
    expect(result.kind).toBe("inline");
    if (result.kind === "inline") {
      const decoded = Buffer.from(result.body, "base64");
      expect(new Uint8Array(decoded)).toEqual(bytes);
      expect(result.contentType).toBe("application/octet-stream");
    }
  });

  it("encodes an empty body as an empty base64 string", () => {
    const result = serializeFulfillmentResult({
      kind: "inline",
      body: new Uint8Array(),
      contentType: "application/octet-stream",
    });
    expect(result).toEqual({
      kind: "inline",
      body: "",
      contentType: "application/octet-stream",
    });
  });
});

describe("serializeFulfillmentResult — async branch", () => {
  it("passes a pointer through verbatim", () => {
    expect(serializeFulfillmentResult({ kind: "async", pointer: "ipfs://bafyTestCid" })).toEqual({
      kind: "async",
      pointer: "ipfs://bafyTestCid",
    });
  });

  it("omits the pointer key when undefined (host delivers fully out-of-band)", () => {
    const result = serializeFulfillmentResult({ kind: "async" });
    expect(result).toEqual({ kind: "async" });
    expect("pointer" in result).toBe(false);
  });
});

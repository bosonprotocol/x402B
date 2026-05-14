import type { BosonMetaTx } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it } from "vitest";

import { decodeSignedPayload, encodeSignedPayload } from "../../src/codec/signed-payload.js";

describe("signed-payload codec", () => {
  it("round-trips a BosonMetaTx through encode → decode", () => {
    const metaTx: BosonMetaTx = {
      from: "0x1111111111111111111111111111111111111111",
      nonce: "42",
      functionName: "redeemVoucher(uint256)",
      functionSignature: `0x${"ab".repeat(36)}`,
      sig: {
        v: 28,
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
      },
    };

    const encoded = encodeSignedPayload(metaTx);
    expect(encoded.startsWith("0x")).toBe(true);

    const decoded = decodeSignedPayload(encoded);
    expect(decoded).toEqual({
      from: metaTx.from.toLowerCase(),
      nonce: metaTx.nonce,
      functionName: metaTx.functionName,
      functionSignature: metaTx.functionSignature,
      sig: metaTx.sig,
    });
  });

  it("preserves a v=27 signature", () => {
    const metaTx: BosonMetaTx = {
      from: "0x2222222222222222222222222222222222222222",
      nonce: "0",
      functionName: "completeExchange(uint256)",
      functionSignature: `0x${"cd".repeat(36)}`,
      sig: {
        v: 27,
        r: `0x${"33".repeat(32)}`,
        s: `0x${"44".repeat(32)}`,
      },
    };

    expect(decodeSignedPayload(encodeSignedPayload(metaTx)).sig.v).toBe(27);
  });
});

import { describe, expect, it } from "vitest";

import {
  bosonTokenAuthToTransferAuthorization,
  type TransferAuthorization,
} from "../../src/internal/token-auth-lift.js";

const R = `0x${"aa".repeat(32)}` as const;
const S = `0x${"bb".repeat(32)}` as const;
const V = 27;
const PACKED_SIG = `0x${"aa".repeat(32)}${"bb".repeat(32)}1b` as const;

describe("bosonTokenAuthToTransferAuthorization", () => {
  it("lifts an ERC-3009 wire payload into the SDK's ERC3009 variant", () => {
    const out: TransferAuthorization = bosonTokenAuthToTransferAuthorization({
      kind: "erc3009",
      data: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "1000000",
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 3600,
        nonce: `0x${"77".repeat(32)}`,
        r: R,
        s: S,
        v: V,
      },
    });
    expect(out.strategy).toBe("ERC3009");
    expect(out.r).toBe(R);
    expect(out.s).toBe(S);
    expect(out.v).toBe(V);
    expect(out.signature).toBe(PACKED_SIG);
    if (out.strategy === "ERC3009") {
      expect(out.data.validAfter).toBe(0);
      expect(out.data.nonce).toBe(`0x${"77".repeat(32)}`);
    }
  });

  it("lifts an EIP-2612 Permit wire payload into the SDK's EIP2612 variant", () => {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const out: TransferAuthorization = bosonTokenAuthToTransferAuthorization({
      kind: "permit",
      data: {
        owner: "0x1111111111111111111111111111111111111111",
        spender: "0x2222222222222222222222222222222222222222",
        value: "1000000",
        deadline,
        r: R,
        s: S,
        v: V,
      },
    });
    expect(out.strategy).toBe("EIP2612");
    expect(out.r).toBe(R);
    expect(out.s).toBe(S);
    expect(out.v).toBe(V);
    expect(out.signature).toBe(PACKED_SIG);
    if (out.strategy === "EIP2612") {
      expect(out.data.deadline).toBe(deadline);
    }
  });

  it("lifts a Permit2 wire payload and unpacks the signature into r/s/v", () => {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const out: TransferAuthorization = bosonTokenAuthToTransferAuthorization({
      kind: "permit2",
      data: {
        permitted: {
          token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: "1000000",
        },
        spender: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        nonce: "42",
        deadline,
        signature: PACKED_SIG,
      },
    });
    expect(out.strategy).toBe("Permit2");
    expect(out.signature).toBe(PACKED_SIG);
    expect(out.r).toBe(R);
    expect(out.s).toBe(S);
    expect(out.v).toBe(V);
    if (out.strategy === "Permit2") {
      expect(out.data.nonce).toBe("42");
      expect(out.data.deadline).toBe(deadline);
    }
  });

  it("rejects a Permit2 signature that is not 65 bytes", () => {
    expect(() =>
      bosonTokenAuthToTransferAuthorization({
        kind: "permit2",
        data: {
          permitted: {
            token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            amount: "1000000",
          },
          spender: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          nonce: "42",
          deadline: 0,
          signature: "0xdeadbeef" as `0x${string}`,
        },
      }),
    ).toThrow(/Permit2 signature must be 65 bytes/);
  });
});

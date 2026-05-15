import type { FulfillmentOption } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it, vi } from "vitest";

import { parseEscrowPaymentPayload } from "../../../core/src/schemes/escrow/index.js";
import { negotiateFulfillment, NoCompatibleFulfillmentError } from "../../src/client/index.js";

const INLINE: FulfillmentOption = { id: "inline", schema: null };
const BUYER = "0x2222222222222222222222222222222222222222";

const EMAIL: FulfillmentOption = {
  id: "email",
  schema: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
};
const XMTP: FulfillmentOption = {
  id: "xmtp",
  schema: {
    type: "object",
    required: ["xmtpAddress"],
    properties: { xmtpAddress: { type: "string" } },
  },
};

const paymentPayloadBase = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: {
    action: "boson-createOfferCommitAndRedeem",
    tokenAuthStrategy: "none",
    offerRef: { fullOffer: { id: "0" }, sellerSig: "0xdeadbeef" },
    buyer: BUYER,
    metaTx: {
      from: BUYER,
      nonce: "0",
      functionName: "createOfferCommitAndRedeem(...)",
      functionSignature: "0xabcd1234",
      sig: {
        v: 27,
        r: "0x" + "11".repeat(32),
        s: "0x" + "22".repeat(32),
      },
    },
  },
} as const;

describe("negotiateFulfillment", () => {
  it("returns a schemaless option immediately with data: null", async () => {
    const choice = await negotiateFulfillment([INLINE, EMAIL], {
      supports: ["inline", "email"],
    });
    expect(choice).toEqual({ option: "inline", data: null });
  });

  it("returns a schemaless choice that core accepts in the payment payload", async () => {
    const choice = await negotiateFulfillment([INLINE], {
      supports: ["inline"],
    });
    // `paymentPayloadBase.payload.action` is the atomic Flow B action,
    // so the commit-time slot may carry both `option` and `data`. The
    // structural schema accepts the full negotiation result directly.
    expect(() =>
      parseEscrowPaymentPayload({
        ...paymentPayloadBase,
        fulfillment: choice,
      }),
    ).not.toThrow();
  });

  it("honours `prefer` ordering when both options are supported", async () => {
    const choice = await negotiateFulfillment([INLINE, XMTP], {
      supports: ["inline", "xmtp"],
      prefer: ["xmtp", "inline"],
      agentContext: { xmtpAddress: "0xabc" },
    });
    expect(choice).toEqual({ option: "xmtp", data: { xmtpAddress: "0xabc" } });
  });

  it("skips options the client doesn't support", async () => {
    const choice = await negotiateFulfillment([XMTP, EMAIL], {
      supports: ["email"],
      agentContext: { email: "buyer@example.com" },
    });
    expect(choice.option).toBe("email");
    expect(choice.data).toEqual({ email: "buyer@example.com" });
  });

  it("falls back to collectInteractive when agentContext is missing required fields", async () => {
    const collectInteractive = vi.fn().mockResolvedValue({ email: "buyer@example.com" });
    const choice = await negotiateFulfillment([EMAIL], {
      supports: ["email"],
      agentContext: {},
      collectInteractive,
    });
    expect(collectInteractive).toHaveBeenCalledWith(EMAIL);
    expect(choice).toEqual({ option: "email", data: { email: "buyer@example.com" } });
  });

  it("throws NoCompatibleFulfillmentError when no option matches", async () => {
    const tryNegotiate = negotiateFulfillment([EMAIL, XMTP], {
      supports: ["email", "xmtp"],
      agentContext: {},
    });
    await expect(tryNegotiate).rejects.toBeInstanceOf(NoCompatibleFulfillmentError);
    await expect(tryNegotiate).rejects.toMatchObject({
      advertised: ["email", "xmtp"],
      attempted: ["email", "xmtp"],
      tried: ["email", "xmtp"],
    });
  });

  it("throws NoCompatibleFulfillmentError with empty advertised[] when seller advertised no options", async () => {
    await expect(negotiateFulfillment([], { supports: ["email"] })).rejects.toMatchObject({
      advertised: [],
      attempted: [],
    });
  });

  it("tracks advertised options separately from supported attempts", async () => {
    await expect(
      negotiateFulfillment([EMAIL, XMTP], {
        supports: ["webhook"],
        agentContext: { email: "buyer@example.com", xmtpAddress: "0xabc" },
      }),
    ).rejects.toMatchObject({
      advertised: ["email", "xmtp"],
      attempted: [],
    });
  });

  it("treats agentContext values that are explicitly undefined as missing", async () => {
    const collectInteractive = vi.fn().mockResolvedValue({ email: "buyer@example.com" });
    const choice = await negotiateFulfillment([EMAIL], {
      supports: ["email"],
      agentContext: { email: undefined },
      collectInteractive,
    });
    // Should NOT short-circuit on agentContext { email: undefined } —
    // that's effectively unsatisfied; collectInteractive runs instead.
    expect(collectInteractive).toHaveBeenCalledWith(EMAIL);
    expect(choice).toEqual({ option: "email", data: { email: "buyer@example.com" } });
  });

  it("rejects non-object collectInteractive output for schemaful options", async () => {
    const collectInteractive = vi.fn(async (opt: FulfillmentOption) =>
      // Email gets a non-object back (a primitive string); xmtp gets a valid object.
      opt.id === "email" ? ("buyer@example.com" as unknown) : { xmtpAddress: "0xabc" },
    );
    const choice = await negotiateFulfillment([EMAIL, XMTP], {
      supports: ["email", "xmtp"],
      collectInteractive,
    });
    // Falls through to xmtp because the email collect returned a primitive.
    expect(choice).toEqual({ option: "xmtp", data: { xmtpAddress: "0xabc" } });
  });

  it("freezes advertised/attempted on the error so callers can't mutate the diagnostic payload", async () => {
    try {
      await negotiateFulfillment([EMAIL, XMTP], {
        supports: ["email", "xmtp"],
        agentContext: {},
      });
      throw new Error("expected NoCompatibleFulfillmentError");
    } catch (err) {
      if (!(err instanceof NoCompatibleFulfillmentError)) throw err;
      expect(Object.isFrozen(err.advertised)).toBe(true);
      expect(Object.isFrozen(err.attempted)).toBe(true);
      expect(() => (err.advertised as string[]).push("oops")).toThrow();
      expect(() => (err.attempted as string[]).push("oops")).toThrow();
    }
  });

  it("rejects collectInteractive output that misses required keys and keeps trying", async () => {
    const collectInteractive = vi.fn(async (opt: FulfillmentOption) =>
      opt.id === "email" ? {} : { xmtpAddress: "0xabc" },
    );
    const choice = await negotiateFulfillment([EMAIL, XMTP], {
      supports: ["email", "xmtp"],
      collectInteractive,
    });
    expect(choice).toEqual({ option: "xmtp", data: { xmtpAddress: "0xabc" } });
    expect(collectInteractive).toHaveBeenCalledTimes(2);
  });
});

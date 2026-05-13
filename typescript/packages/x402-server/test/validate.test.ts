// Exhaustive 13-rule coverage for `validatePaymentPayload`. Happy
// paths for `none` + `erc3009` + `permit` + `permit2`, plus one
// negative case per spec rule (rules 1–11, 13). Rule 12 is RPC-bound
// and intentionally skipped at this layer.

import { describe, expect, it } from "vitest";

import { validatePaymentPayload, decodeXPaymentHeader } from "../src/index.js";
import { CHAIN_ID, ESCROW, makePaymentFixture, NETWORK, TOKEN } from "./fixtures.js";

describe("validatePaymentPayload — happy paths", () => {
  it("accepts a valid `none` payload", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "none" });
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid `erc3009` payload", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "erc3009" });
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid `permit` payload", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "permit" });
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid `permit2` payload", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "permit2" });
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result.ok).toBe(true);
  });
});

describe("validatePaymentPayload — rule failures", () => {
  it("rule 2 — rejects network mismatch", async () => {
    const fx = await makePaymentFixture();
    const result = await validatePaymentPayload({
      payload: { ...fx.payload, network: "eip155:1" },
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 2, code: "NETWORK_MISMATCH" });
  });

  it("rule 3 — rejects fullOffer mismatch (price tampered)", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        offerRef: {
          ...fx.payload.payload.offerRef,
          fullOffer: { ...fx.payload.payload.offerRef.fullOffer, price: "9999999" },
        },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 3, code: "FULL_OFFER_MISMATCH" });
  });

  it("rule 4 — rejects sellerSig mismatch", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        offerRef: { ...fx.payload.payload.offerRef, sellerSig: "0xdeadbeef" },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 4, code: "SELLER_SIG_MISMATCH" });
  });

  it("rule 5 — rejects action not in requirements.actions.next", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: { ...fx.payload.payload, action: "boson-redeem" },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 5, code: "ACTION_NOT_IN_REQUIREMENTS" });
  });

  it("rule 6 — rejects tokenAuthStrategy not in requirements", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "none" });
    const tampered = {
      ...fx.payload,
      payload: { ...fx.payload.payload, tokenAuthStrategy: "permit" as const },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 6, code: "TOKEN_AUTH_NOT_IN_REQUIREMENTS" });
  });

  it("rule 7 — rejects functionSignature tampering", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        metaTx: { ...fx.payload.payload.metaTx, functionSignature: "0xdeadbeef" },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 7, code: "CALLDATA_MISMATCH" });
  });

  it("rule 8 — rejects when buyer.address ≠ metaTx.from", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        metaTx: { ...fx.payload.payload.metaTx, from: ESCROW },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 8, code: "BAD_META_TX_SIGNATURE" });
  });

  it("rule 8 — rejects bad meta-tx signature (wrong v)", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        metaTx: {
          ...fx.payload.payload.metaTx,
          sig: {
            ...fx.payload.payload.metaTx.sig,
            v: fx.payload.payload.metaTx.sig.v === 27 ? 28 : 27,
          },
        },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 8, code: "BAD_META_TX_SIGNATURE" });
  });

  it("rule 8 — returns a structured failure for unrecoverable signatures", async () => {
    const fx = await makePaymentFixture();
    const tampered = {
      ...fx.payload,
      payload: {
        ...fx.payload.payload,
        metaTx: {
          ...fx.payload.payload.metaTx,
          sig: {
            ...fx.payload.payload.metaTx.sig,
            v: 999,
          },
        },
      },
    };
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({
      ok: false,
      rule: 8,
      code: "BAD_META_TX_SIGNATURE",
      field: "payload.metaTx.sig",
    });
  });

  it("rule 9 — rejects erc3009 amount mismatch", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "erc3009" });
    const tampered = JSON.parse(JSON.stringify(fx.payload)) as typeof fx.payload;
    if (tampered.payload.tokenAuth?.kind === "erc3009") {
      tampered.payload.tokenAuth.data.value = "1";
    }
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 9, code: "TOKEN_AUTH_AMOUNT_MISMATCH" });
  });

  it("rule 10 — rejects permit deadline past horizon", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "permit", maxTimeoutSeconds: 300 });
    const tampered = JSON.parse(JSON.stringify(fx.payload)) as typeof fx.payload;
    if (tampered.payload.tokenAuth?.kind === "permit") {
      tampered.payload.tokenAuth.data.deadline = Math.floor(Date.now() / 1000) + 99_999;
    }
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 10, code: "TOKEN_AUTH_DEADLINE_EXCEEDED" });
  });

  it("rule 11 — rejects permit2 spender mismatch", async () => {
    const fx = await makePaymentFixture({ tokenAuthStrategy: "permit2" });
    const tampered = JSON.parse(JSON.stringify(fx.payload)) as typeof fx.payload;
    if (tampered.payload.tokenAuth?.kind === "permit2") {
      tampered.payload.tokenAuth.data.spender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    }
    const result = await validatePaymentPayload({
      payload: tampered,
      requirements: fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 11, code: "TOKEN_AUTH_SPENDER_MISMATCH" });
  });

  it("rule 13 — rejects missing fulfillment when required", async () => {
    const fx = await makePaymentFixture();
    const requirementsWithFulfillment = {
      ...fx.requirements,
      fulfillment: {
        required: true,
        options: [{ id: "email", schema: { type: "object" as const } }],
      },
    };
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: requirementsWithFulfillment,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 13, code: "FULFILLMENT_REQUIRED" });
  });

  it("rule 13 — rejects fulfillment option not advertised", async () => {
    const fx = await makePaymentFixture();
    const requirementsWithFulfillment = {
      ...fx.requirements,
      fulfillment: {
        required: true,
        options: [{ id: "email", schema: { type: "object" as const } }],
      },
    };
    const payloadWithBadOption = {
      ...fx.payload,
      fulfillment: { option: "smoke-signal", data: {} },
    };
    const result = await validatePaymentPayload({
      payload: payloadWithBadOption,
      requirements: requirementsWithFulfillment,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({
      ok: false,
      rule: 13,
      code: "FULFILLMENT_OPTION_NOT_ADVERTISED",
    });
  });

  it("rule 13 — rejects fulfillment data when caller-supplied validator fails", async () => {
    const fx = await makePaymentFixture();
    const requirementsWithFulfillment = {
      ...fx.requirements,
      fulfillment: {
        required: true,
        options: [{ id: "email", schema: { type: "object" as const } }],
      },
    };
    const payloadWithFulfillment = {
      ...fx.payload,
      fulfillment: { option: "email", data: { email: "not-an-email" } },
    };
    const result = await validatePaymentPayload({
      payload: payloadWithFulfillment,
      requirements: requirementsWithFulfillment,
      chainId: CHAIN_ID,
      validateFulfillmentData: (_option, _data) => ({ ok: false, reason: "bad email" }),
    });
    expect(result).toMatchObject({ ok: false, rule: 13, code: "FULFILLMENT_DATA_INVALID" });
  });
});

describe("validatePaymentPayload — unsupported calldata builders", () => {
  it("rule 7 — fails closed for `boson-createOfferCommitAndRedeem` until its builder lands", async () => {
    const fx = await makePaymentFixture({ action: "boson-createOfferCommitAndRedeem" });
    // Patch requirements to advertise the atomic action so rule 5 passes.
    const requirements = {
      ...fx.requirements,
      actions: {
        ...fx.requirements.actions,
        next: [
          ...fx.requirements.actions.next,
          {
            id: "boson-createOfferCommitAndRedeem",
            channels: ["server", "facilitator", "onchain"] as const,
          },
        ],
      },
    };
    const result = await validatePaymentPayload({
      payload: fx.payload,
      requirements: requirements as typeof fx.requirements,
      chainId: CHAIN_ID,
    });
    expect(result).toMatchObject({ ok: false, rule: 7, code: "CALLDATA_MISMATCH" });
  });
});

describe("decodeXPaymentHeader", () => {
  it("round-trips a base64-encoded JSON payload", () => {
    const json = JSON.stringify({
      x402Version: 2,
      scheme: "escrow",
      network: NETWORK,
      payload: {
        action: "boson-createOfferAndCommit",
        tokenAuthStrategy: "none",
        offerRef: { fullOffer: {}, sellerSig: "0x00" },
        buyer: "0x1111111111111111111111111111111111111111",
        metaTx: {
          from: "0x1111111111111111111111111111111111111111",
          nonce: "1",
          functionName: "createOfferAndCommit(...)",
          functionSignature: "0xdeadbeef",
          sig: {
            v: 27,
            r: `0x${"00".repeat(32)}`,
            s: `0x${"00".repeat(32)}`,
          },
        },
      },
    });
    const header = Buffer.from(json, "utf8").toString("base64");
    const result = decodeXPaymentHeader(header);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.scheme).toBe("escrow");
      expect(result.payload.network).toBe(NETWORK);
    }
  });

  it("returns MISSING_HEADER for empty input", () => {
    expect(decodeXPaymentHeader(undefined)).toMatchObject({ ok: false, code: "MISSING_HEADER" });
    expect(decodeXPaymentHeader("")).toMatchObject({ ok: false, code: "MISSING_HEADER" });
  });

  it("returns INVALID_BASE64 for garbage", () => {
    expect(decodeXPaymentHeader("!!!not-base64!!!")).toMatchObject({
      ok: false,
      code: "INVALID_BASE64",
    });
  });

  it("returns INVALID_PAYLOAD for valid JSON but bad shape", () => {
    const header = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64");
    expect(decodeXPaymentHeader(header)).toMatchObject({
      ok: false,
      code: "INVALID_PAYLOAD",
    });
  });
});

// Silence unused-import linter — TOKEN is exported from fixtures for
// future tests but not referenced in this file.
void TOKEN;

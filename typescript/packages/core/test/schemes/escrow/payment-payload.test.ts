import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import Ajv, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import {
  escrowPaymentPayloadSchema,
  parseEscrowPaymentPayload,
} from "../../../src/schemes/escrow/index.js";
import {
  validPayloadErc3009,
  validPayloadNone,
  validPayloadPermit,
  validPayloadPermit2,
} from "./fixtures.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const schemaPath = join(
  here,
  "..",
  "..",
  "..",
  "src",
  "schemes",
  "escrow",
  "schemas",
  "payment_payload.schema.json",
);
const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const ajvValidate: ValidateFunction = ajv.compile(jsonSchema);

const fixtures = {
  none: validPayloadNone,
  erc3009: validPayloadErc3009,
  permit: validPayloadPermit,
  permit2: validPayloadPermit2,
} as const;

describe("EscrowPaymentPayload — happy path", () => {
  for (const [strategy, fixture] of Object.entries(fixtures)) {
    it(`zod and ajv both accept the ${strategy} fixture`, () => {
      expect(() => parseEscrowPaymentPayload(fixture)).not.toThrow();
      const ok = ajvValidate(fixture);
      expect(ajvValidate.errors ?? null).toBeNull();
      expect(ok).toBe(true);
    });
  }

  it("accepts the option-only commit-time fulfillment slot", () => {
    const parsed = parseEscrowPaymentPayload(validPayloadNone);
    expect(parsed.fulfillment).toEqual({ option: "inline" });
    expect(ajvValidate(validPayloadNone)).toBe(true);
  });
});

describe("EscrowPaymentPayload — rejection cases", () => {
  it("rejects wrong scheme literal", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadErc3009));
    bad.scheme = "exact";
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects mismatched discriminator (kind=permit but erc3009-shaped data)", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadErc3009));
    bad.payload.tokenAuth.kind = "permit";
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects metaTx.sig.r that is not 32 bytes", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadNone));
    bad.payload.metaTx.sig.r = "0xabcd";
    const zod = escrowPaymentPayloadSchema.safeParse(bad);
    expect(zod.success).toBe(false);
    if (!zod.success) {
      const path = zod.error.issues[0]?.path.join(".") ?? "";
      expect(path).toContain("metaTx");
    }
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects unknown tokenAuthStrategy", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadErc3009));
    bad.payload.tokenAuthStrategy = "uniswap-v4";
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects extra unknown field on the payload", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadNone));
    bad.payload.extra = "nope";
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects negative validBefore in erc3009", () => {
    const bad = JSON.parse(JSON.stringify(validPayloadErc3009));
    bad.payload.tokenAuth.data.validBefore = -1;
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects a commit-time payload carrying fulfillment.data", () => {
    // Wire-format change: the commit-time slot now carries only the
    // chosen option; buyer-supplied delivery data flows on the
    // redeem-time POST body. Both zod and the JSON Schema must enforce
    // this strictly so clients that haven't migrated surface the error.
    const bad = JSON.parse(JSON.stringify(validPayloadNone));
    bad.fulfillment = { option: "inline", data: null };
    expect(escrowPaymentPayloadSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });
});

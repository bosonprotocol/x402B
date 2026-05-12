import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  escrowPaymentRequirementsSchema,
  parseEscrowPaymentRequirements,
} from "../../../src/schemes/escrow/index.js";
import { validRequirements } from "./fixtures.js";

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
  "payment_requirements.schema.json",
);
const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
// Register the standard JSON Schema string formats (notably `date-time`)
// so Ajv actually enforces them — Ajv v8 ignores formats by default.
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const ajvValidate: ValidateFunction = ajv.compile(jsonSchema);

const cloneFixture = (): typeof validRequirements => JSON.parse(JSON.stringify(validRequirements));

describe("EscrowPaymentRequirements — happy path", () => {
  it("zod accepts the canonical fixture", () => {
    expect(() => parseEscrowPaymentRequirements(validRequirements)).not.toThrow();
  });

  it("ajv accepts the canonical fixture", () => {
    const ok = ajvValidate(validRequirements);
    expect(ajvValidate.errors ?? null).toBeNull();
    expect(ok).toBe(true);
  });

  it("zod and ajv agree on the canonical fixture", () => {
    const zodOk = escrowPaymentRequirementsSchema.safeParse(validRequirements).success;
    const ajvOk = ajvValidate(validRequirements);
    expect(zodOk).toBe(ajvOk);
  });
});

describe("EscrowPaymentRequirements — rejection cases", () => {
  it("rejects wrong scheme", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    bad.scheme = "exact";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects non-EVM network", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    bad.network = "solana:mainnet";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects missing offer", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    delete bad.offer;
    const zod = escrowPaymentRequirementsSchema.safeParse(bad);
    expect(zod.success).toBe(false);
    if (!zod.success) {
      expect(zod.error.issues.some((i) => i.path.includes("offer"))).toBe(true);
    }
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects empty tokenAuthStrategies", () => {
    const bad = cloneFixture();
    bad.tokenAuthStrategies = [];
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects malformed escrowAddress", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    bad.escrowAddress = "not-an-address";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects amount with leading zeros", () => {
    const bad = cloneFixture();
    bad.amount = "01000";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects unknown top-level field", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    bad.surprise = "extra";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects empty actions.next", () => {
    const bad = cloneFixture();
    bad.actions.next = [];
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });
});

describe("EscrowPaymentRequirements — actions.next[].deadline", () => {
  it("accepts an ISO 8601 deadline on an action entry", () => {
    const ok = cloneFixture();
    ok.actions.next[0].deadline = "2026-05-15T00:00:00Z";
    expect(escrowPaymentRequirementsSchema.safeParse(ok).success).toBe(true);
    expect(ajvValidate(ok)).toBe(true);
  });

  it("rejects a malformed deadline", () => {
    const bad = cloneFixture();
    bad.actions.next[0].deadline = "not-a-date";
    expect(escrowPaymentRequirementsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });
});

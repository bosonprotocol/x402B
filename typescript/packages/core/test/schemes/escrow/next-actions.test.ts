import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import Ajv, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import {
  escrowNextActionsSchema,
  parseEscrowNextActions,
  type EscrowNextActions,
} from "../../../src/schemes/escrow/index.js";
import { DisputeState, ExchangeState } from "../../../src/state-machine/index.js";
import { ESCROW } from "./fixtures.js";

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
  "next_actions.schema.json",
);
const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const ajvValidate: ValidateFunction = ajv.compile(jsonSchema);

const fallback = {
  xmtp: "0xSellerXMTP",
  mcp: "boson://seller/12345",
  onchainHints: {
    escrow: ESCROW,
    metaTxFacet: "MetaTransactionsHandlerFacet",
    metaTxEntrypoints: {
      none: "executeMetaTransaction",
      erc3009: "executeMetaTransactionWithTokenTransferAuthorization",
      permit: "executeMetaTransactionWithTokenTransferAuthorization",
      permit2: "executeMetaTransactionWithTokenTransferAuthorization",
    },
    actionFacets: { "boson-redeem": "ExchangeHandlerFacet" },
  },
} as const;

const validNonDisputed: EscrowNextActions = {
  exchangeId: "12345",
  exchangeState: ExchangeState.REDEEMED,
  next: [
    {
      id: "boson-completeExchange",
      channels: ["server", "facilitator", "onchain"],
      deadline: "2026-05-15T00:00:00Z",
    },
  ],
  fallback,
};

const validDisputed: EscrowNextActions = {
  exchangeId: "42",
  exchangeState: ExchangeState.DISPUTED,
  disputeState: DisputeState.RESOLVING,
  next: [
    { id: "boson-resolveDispute", channels: ["server", "onchain"] },
    { id: "boson-escalateDispute", channels: ["onchain"] },
    { id: "boson-retractDispute", channels: ["server", "onchain"] },
  ],
  fallback,
};

describe("EscrowNextActions — happy path", () => {
  it("zod accepts a non-DISPUTED envelope with deadline", () => {
    expect(() => parseEscrowNextActions(validNonDisputed)).not.toThrow();
  });

  it("ajv accepts a non-DISPUTED envelope with deadline", () => {
    const ok = ajvValidate(validNonDisputed);
    expect(ajvValidate.errors ?? null).toBeNull();
    expect(ok).toBe(true);
  });

  it("zod accepts a DISPUTED envelope with disputeState", () => {
    expect(() => parseEscrowNextActions(validDisputed)).not.toThrow();
  });

  it("ajv accepts a DISPUTED envelope with disputeState", () => {
    const ok = ajvValidate(validDisputed);
    expect(ajvValidate.errors ?? null).toBeNull();
    expect(ok).toBe(true);
  });
});

describe("EscrowNextActions — invariants", () => {
  it("rejects DISPUTED without disputeState", () => {
    const bad = { ...validDisputed } as Record<string, unknown>;
    delete bad.disputeState;
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects non-DISPUTED with disputeState", () => {
    const bad = { ...validNonDisputed, disputeState: DisputeState.RESOLVING } as Record<
      string,
      unknown
    >;
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects unknown top-level field", () => {
    const bad = { ...validNonDisputed, surprise: "extra" } as Record<string, unknown>;
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects unknown action-entry field", () => {
    const bad = JSON.parse(JSON.stringify(validNonDisputed)) as Record<string, unknown>;
    (bad.next as Array<Record<string, unknown>>)[0].surprise = "extra";
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects missing exchangeId", () => {
    const bad = { ...validNonDisputed } as Record<string, unknown>;
    delete bad.exchangeId;
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
    expect(ajvValidate(bad)).toBe(false);
  });

  it("rejects malformed deadline (not ISO 8601)", () => {
    const bad = JSON.parse(JSON.stringify(validNonDisputed)) as Record<string, unknown>;
    (bad.next as Array<Record<string, unknown>>)[0].deadline = "not-a-date";
    expect(escrowNextActionsSchema.safeParse(bad).success).toBe(false);
  });
});

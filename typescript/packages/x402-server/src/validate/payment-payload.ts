// `validatePaymentPayload` — the 13-rule X-PAYMENT validator from
// docs/boson-impl-01-escrow-scheme.md §5. Pure function; no I/O.
//
// The validator returns a discriminated `{ ok: true } | { ok: false, … }`
// result. On failure, the result carries the spec's rule number, a
// stable string code, and the field/expected/got triple from the spec
// (so callers can serialise it directly into a 400 body).
//
// Rule 12 (`none` strategy → server SHOULD pre-flight allowance check)
// is RPC-dependent and intentionally NOT enforced here — the
// composition layer (PR 4) runs it as part of `verifyExchange`.
//
// Rule 7 byte-compares `payload.metaTx.functionSignature` against
// calldata reconstructed from `payload.offerRef`. The reconstruction
// path for `boson-createOfferCommitAndRedeem` (Flow B) is gated on
// `@bosonprotocol/x402-evm`'s atomic builder which still throws
// `NotYetSupportedError` pending contracts PR #1105; until that builder
// exists, Flow B fails closed rather than accepting unchecked calldata.

import { recoverMetaTransactionSigner } from "@bosonprotocol/x402-core/eip712";
import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
  FulfillmentOption,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { buildCreateOfferAndCommitCalldata } from "@bosonprotocol/x402-evm";
import type { Address as ViemAddress, Hex as ViemHex } from "viem";

type BuilderFullOffer = Parameters<typeof buildCreateOfferAndCommitCalldata>[0]["fullOffer"];

export type ValidatePaymentPayloadResult =
  | { ok: true; warnings?: ValidationWarning[] }
  | {
      ok: false;
      rule: number;
      code: ValidationErrorCode;
      field?: string;
      expected?: unknown;
      got?: unknown;
      reason?: string;
    };

export type ValidationErrorCode =
  | "SCHEME_MISMATCH"
  | "NETWORK_MISMATCH"
  | "FULL_OFFER_MISMATCH"
  | "SELLER_SIG_MISMATCH"
  | "ACTION_NOT_IN_REQUIREMENTS"
  | "TOKEN_AUTH_NOT_IN_REQUIREMENTS"
  | "CALLDATA_MISMATCH"
  | "BAD_META_TX_SIGNATURE"
  | "TOKEN_AUTH_AMOUNT_MISMATCH"
  | "TOKEN_AUTH_RECIPIENT_MISMATCH"
  | "TOKEN_AUTH_SPENDER_MISMATCH"
  | "TOKEN_AUTH_TOKEN_MISMATCH"
  | "TOKEN_AUTH_DEADLINE_EXCEEDED"
  | "TOKEN_AUTH_MISSING"
  | "TOKEN_AUTH_UNEXPECTED"
  | "FULFILLMENT_REQUIRED"
  | "FULFILLMENT_OPTION_NOT_ADVERTISED"
  | "FULFILLMENT_DATA_INVALID";

export interface ValidationWarning {
  rule: number;
  code: "RULE_SKIPPED";
  reason: string;
}

export interface ValidatePaymentPayloadArgs {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
  /** EVM chain id matching `requirements.network` — drives meta-tx EIP-712 signer recovery (rule 8). */
  chainId: number;
  /** Reference time in seconds since epoch for rules 9–11. Defaults to `Math.floor(Date.now() / 1000)`. */
  now?: number;
  /** Optional per-fulfillment-option data validator (typically the `FulfillmentRegistry`'s per-channel `validate`). Without it, rule 13 only checks `option` membership. */
  validateFulfillmentData?: (
    option: string,
    data: Record<string, unknown> | null,
  ) => { ok: true } | { ok: false; reason: string };
}

/**
 * Run all 13 rules. Short-circuits at the first failure.
 */
export async function validatePaymentPayload(
  args: ValidatePaymentPayloadArgs,
): Promise<ValidatePaymentPayloadResult> {
  const { payload, requirements } = args;
  // Rule 1 — scheme equality on both sides.
  if (payload.scheme !== "escrow" || requirements.scheme !== "escrow") {
    return failure(1, "SCHEME_MISMATCH", "scheme", "escrow", payload.scheme);
  }

  // Rule 2 — network equality.
  if (payload.network !== requirements.network) {
    return failure(2, "NETWORK_MISMATCH", "network", requirements.network, payload.network);
  }

  // Rule 3 — fullOffer deep equality (byte-equals in canonical form).
  if (!deepEqual(payload.payload.offerRef.fullOffer, requirements.offer.fullOffer)) {
    return failure(
      3,
      "FULL_OFFER_MISMATCH",
      "payload.offerRef.fullOffer",
      "<requirements.offer.fullOffer>",
      "<payload.offerRef.fullOffer>",
    );
  }

  // Rule 4 — sellerSig equality.
  if (payload.payload.offerRef.sellerSig !== requirements.offer.sellerSig) {
    return failure(
      4,
      "SELLER_SIG_MISMATCH",
      "payload.offerRef.sellerSig",
      requirements.offer.sellerSig,
      payload.payload.offerRef.sellerSig,
    );
  }

  // Rule 5 — action advertised in requirements.actions.next.
  const advertisedActions = requirements.actions.next.map((entry) => entry.id);
  if (!advertisedActions.includes(payload.payload.action)) {
    return failure(
      5,
      "ACTION_NOT_IN_REQUIREMENTS",
      "payload.action",
      advertisedActions,
      payload.payload.action,
    );
  }

  // Rule 6 — tokenAuthStrategy advertised in requirements.tokenAuthStrategies.
  if (!requirements.tokenAuthStrategies.includes(payload.payload.tokenAuthStrategy)) {
    return failure(
      6,
      "TOKEN_AUTH_NOT_IN_REQUIREMENTS",
      "payload.tokenAuthStrategy",
      requirements.tokenAuthStrategies,
      payload.payload.tokenAuthStrategy,
    );
  }

  // Rule 7 — functionSignature byte-equals the calldata reconstructed
  // from offerRef. Only enforced for `boson-createOfferAndCommit`
  // (Flow A); Flow B's builder still throws `NotYetSupportedError`.
  const rule7 = checkRule7(payload);
  if (rule7 !== null) return rule7;

  // Rule 8 — meta-tx signer recovers to payload.buyer === metaTx.from.
  if (payload.payload.buyer.toLowerCase() !== payload.payload.metaTx.from.toLowerCase()) {
    return failure(
      8,
      "BAD_META_TX_SIGNATURE",
      "payload.metaTx.from",
      payload.payload.buyer,
      payload.payload.metaTx.from,
    );
  }
  let recovered: ViemAddress;
  try {
    recovered = await recoverMetaTransactionSigner({
      chainId: args.chainId,
      verifyingContract: requirements.escrowAddress as ViemAddress,
      message: {
        nonce: BigInt(payload.payload.metaTx.nonce),
        from: payload.payload.metaTx.from as ViemAddress,
        contractAddress: requirements.escrowAddress as ViemAddress,
        functionName: payload.payload.metaTx.functionName,
        functionSignature: payload.payload.metaTx.functionSignature as ViemHex,
      },
      signature: encodeRsv(payload.payload.metaTx.sig) as ViemHex,
    });
  } catch (e) {
    return failure(
      8,
      "BAD_META_TX_SIGNATURE",
      "payload.metaTx.sig",
      "recoverable ECDSA signature",
      payload.payload.metaTx.sig,
      (e as Error).message,
    );
  }
  if (recovered.toLowerCase() !== payload.payload.buyer.toLowerCase()) {
    return failure(
      8,
      "BAD_META_TX_SIGNATURE",
      "payload.metaTx.sig",
      payload.payload.buyer,
      recovered,
    );
  }

  // Rules 9–11 — strategy-specific token-auth structural checks.
  const strategyResult = checkTokenAuthRules(payload, requirements, args.now);
  if (strategyResult !== null) return strategyResult;

  // Rule 12 — `none` strategy SHOULD pre-flight `IERC20.allowance` on
  // chain. Intentionally not enforced here; runs as part of
  // `verifyExchange` in PR 4 (RPC dependency).

  // Rule 13 — fulfillment.
  const fulfillmentResult = checkFulfillment(payload, requirements, args.validateFulfillmentData);
  if (fulfillmentResult !== null) return fulfillmentResult;

  return { ok: true };
}

function checkRule7(payload: EscrowPaymentPayload): ValidatePaymentPayloadResult | null {
  const action = payload.payload.action;
  if (action === "boson-createOfferAndCommit") {
    const fullOfferWithSig = {
      ...payload.payload.offerRef.fullOffer,
      signature: payload.payload.offerRef.sellerSig,
    } as unknown as BuilderFullOffer;

    let expected: ReturnType<typeof buildCreateOfferAndCommitCalldata>;
    try {
      expected = buildCreateOfferAndCommitCalldata({ fullOffer: fullOfferWithSig });
    } catch (e) {
      return failure(
        7,
        "CALLDATA_MISMATCH",
        "payload.metaTx.functionSignature",
        undefined,
        undefined,
        (e as Error).message,
      );
    }

    if (expected.functionName !== payload.payload.metaTx.functionName) {
      return failure(
        7,
        "CALLDATA_MISMATCH",
        "payload.metaTx.functionName",
        expected.functionName,
        payload.payload.metaTx.functionName,
      );
    }
    if (
      expected.functionSignature.toLowerCase() !==
      payload.payload.metaTx.functionSignature.toLowerCase()
    ) {
      return failure(
        7,
        "CALLDATA_MISMATCH",
        "payload.metaTx.functionSignature",
        expected.functionSignature,
        payload.payload.metaTx.functionSignature,
      );
    }
    return null;
  }
  if (action === "boson-createOfferCommitAndRedeem") {
    return failure(
      7,
      "CALLDATA_MISMATCH",
      "payload.action",
      "supported calldata reconstruction",
      action,
      "calldata reconstruction for boson-createOfferCommitAndRedeem is gated on contracts PR #1105 (NotYetSupportedError in @bosonprotocol/x402-evm)",
    );
  }
  // Other actions (boson-redeem, dispute/*, etc.) aren't commit-time;
  // they have their own meta-tx encodings outside this scheme's
  // payment-payload validator. If we ever see one here it's a config
  // bug — the action wouldn't have been listed in
  // requirements.actions.next at commit time.
  return failure(
    7,
    "CALLDATA_MISMATCH",
    "payload.action",
    "boson-createOfferAndCommit | boson-createOfferCommitAndRedeem",
    action,
    "rule-7 calldata reconstruction is only defined for commit-time actions",
  );
}

function checkTokenAuthRules(
  payload: EscrowPaymentPayload,
  requirements: EscrowPaymentRequirements,
  nowSec?: number,
): ValidatePaymentPayloadResult | null {
  const strategy = payload.payload.tokenAuthStrategy;
  const tokenAuth = payload.payload.tokenAuth;
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const horizon = now + requirements.maxTimeoutSeconds;

  if (strategy === "none") {
    if (tokenAuth !== undefined) {
      return failure(
        9,
        "TOKEN_AUTH_UNEXPECTED",
        "payload.tokenAuth",
        "undefined (strategy=none)",
        tokenAuth.kind,
      );
    }
    return null;
  }

  // strategy is one of erc3009 / permit / permit2 — token-auth required.
  if (tokenAuth === undefined) {
    return failure(
      9,
      "TOKEN_AUTH_MISSING",
      "payload.tokenAuth",
      `<${strategy} authorization>`,
      "undefined",
    );
  }
  if (tokenAuth.kind !== strategy) {
    return failure(9, "TOKEN_AUTH_MISSING", "payload.tokenAuth.kind", strategy, tokenAuth.kind);
  }

  switch (tokenAuth.kind) {
    case "erc3009": {
      if (tokenAuth.data.value !== requirements.amount) {
        return failure(
          9,
          "TOKEN_AUTH_AMOUNT_MISMATCH",
          "payload.tokenAuth.data.value",
          requirements.amount,
          tokenAuth.data.value,
        );
      }
      if (tokenAuth.data.to.toLowerCase() !== requirements.escrowAddress.toLowerCase()) {
        return failure(
          9,
          "TOKEN_AUTH_RECIPIENT_MISMATCH",
          "payload.tokenAuth.data.to",
          requirements.escrowAddress,
          tokenAuth.data.to,
        );
      }
      if (tokenAuth.data.validBefore > horizon) {
        return failure(
          9,
          "TOKEN_AUTH_DEADLINE_EXCEEDED",
          "payload.tokenAuth.data.validBefore",
          `<= ${horizon}`,
          tokenAuth.data.validBefore,
        );
      }
      return null;
    }
    case "permit": {
      if (tokenAuth.data.value !== requirements.amount) {
        return failure(
          10,
          "TOKEN_AUTH_AMOUNT_MISMATCH",
          "payload.tokenAuth.data.value",
          requirements.amount,
          tokenAuth.data.value,
        );
      }
      if (tokenAuth.data.spender.toLowerCase() !== requirements.escrowAddress.toLowerCase()) {
        return failure(
          10,
          "TOKEN_AUTH_SPENDER_MISMATCH",
          "payload.tokenAuth.data.spender",
          requirements.escrowAddress,
          tokenAuth.data.spender,
        );
      }
      if (tokenAuth.data.deadline > horizon) {
        return failure(
          10,
          "TOKEN_AUTH_DEADLINE_EXCEEDED",
          "payload.tokenAuth.data.deadline",
          `<= ${horizon}`,
          tokenAuth.data.deadline,
        );
      }
      return null;
    }
    case "permit2": {
      if (tokenAuth.data.permitted.amount !== requirements.amount) {
        return failure(
          11,
          "TOKEN_AUTH_AMOUNT_MISMATCH",
          "payload.tokenAuth.data.permitted.amount",
          requirements.amount,
          tokenAuth.data.permitted.amount,
        );
      }
      if (tokenAuth.data.permitted.token.toLowerCase() !== requirements.asset.toLowerCase()) {
        return failure(
          11,
          "TOKEN_AUTH_TOKEN_MISMATCH",
          "payload.tokenAuth.data.permitted.token",
          requirements.asset,
          tokenAuth.data.permitted.token,
        );
      }
      if (tokenAuth.data.spender.toLowerCase() !== requirements.escrowAddress.toLowerCase()) {
        return failure(
          11,
          "TOKEN_AUTH_SPENDER_MISMATCH",
          "payload.tokenAuth.data.spender",
          requirements.escrowAddress,
          tokenAuth.data.spender,
        );
      }
      if (tokenAuth.data.deadline > horizon) {
        return failure(
          11,
          "TOKEN_AUTH_DEADLINE_EXCEEDED",
          "payload.tokenAuth.data.deadline",
          `<= ${horizon}`,
          tokenAuth.data.deadline,
        );
      }
      return null;
    }
  }
}

function checkFulfillment(
  payload: EscrowPaymentPayload,
  requirements: EscrowPaymentRequirements,
  validator?: ValidatePaymentPayloadArgs["validateFulfillmentData"],
): ValidatePaymentPayloadResult | null {
  const required = requirements.fulfillment?.required === true;
  const carried = payload.fulfillment;
  if (!required) return null;

  if (carried === undefined) {
    return failure(
      13,
      "FULFILLMENT_REQUIRED",
      "payload.fulfillment",
      "<option + data>",
      "undefined",
    );
  }

  const advertised: FulfillmentOption[] = requirements.fulfillment?.options ?? [];
  const matched = advertised.find((option) => option.id === carried.option);
  if (!matched) {
    return failure(
      13,
      "FULFILLMENT_OPTION_NOT_ADVERTISED",
      "payload.fulfillment.option",
      advertised.map((o) => o.id),
      carried.option,
    );
  }

  if (validator !== undefined) {
    const result = validator(carried.option, carried.data);
    if (!result.ok) {
      return failure(
        13,
        "FULFILLMENT_DATA_INVALID",
        "payload.fulfillment.data",
        matched.schema,
        carried.data,
        result.reason,
      );
    }
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Concatenate the buyer's split-form `(v, r, s)` triple into the
 * 65-byte signature shape viem's `recoverTypedDataAddress` accepts.
 * `v` is normalised to the high byte; `r` and `s` are zero-padded to
 * 32 bytes (they're already that in the wire-format schema, but we
 * defend in depth).
 */
function encodeRsv(sig: { v: number; r: string; s: string }): string {
  if (sig.v !== 0 && sig.v !== 1 && sig.v !== 27 && sig.v !== 28) {
    throw new Error("signature v must be 0, 1, 27, or 28");
  }
  const r = sig.r.replace(/^0x/, "").padStart(64, "0");
  const s = sig.s.replace(/^0x/, "").padStart(64, "0");
  const normalizedV = sig.v === 0 || sig.v === 1 ? sig.v + 27 : sig.v;
  const v = normalizedV.toString(16).padStart(2, "0");
  return `0x${r}${s}${v}`;
}

function failure(
  rule: number,
  code: ValidationErrorCode,
  field?: string,
  expected?: unknown,
  got?: unknown,
  reason?: string,
): ValidatePaymentPayloadResult {
  const out: ValidatePaymentPayloadResult = { ok: false, rule, code };
  if (field !== undefined) (out as { field?: string }).field = field;
  if (expected !== undefined) (out as { expected?: unknown }).expected = expected;
  if (got !== undefined) (out as { got?: unknown }).got = got;
  if (reason !== undefined) (out as { reason?: string }).reason = reason;
  return out;
}

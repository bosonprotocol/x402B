// Negative-path payload crafting for the commit-time validation suite
// (section C of the e2e plan).
//
// The happy-path `BuyerActor.fetch` auto-signs and retries, hiding the
// `X-PAYMENT` payload. These helpers expose it so a scenario can tamper a
// single field on an otherwise-valid payload and assert the resulting
// rejection:
//
//   1. `fetchEscrowChallenge` — GET /resource → the 402's escrow
//      `accepts[]` entry (the `EscrowPaymentRequirements`).
//   2. `client.handle402(...)` → the canonical base64 `X-PAYMENT` value.
//   3. decode → mutate → re-encode.
//   4. `submitPaymentHeader` — re-issue /resource with the crafted header.
//
// Both requests carry the SAME `X-X402-Boson-Session-Id` so the resource
// server's offer cache hands back the same signed offer for the retry —
// the validator deep-equals `payload.offerRef.fullOffer` against
// `requirements.offer.fullOffer`, so a fresh offer between the two
// requests would trip rule 3 instead of the rule under test. This mirrors
// `wrapFetchWithPayment`.

import type { X402bClient } from "@bosonprotocol/x402-client";
import { SESSION_ID_HEADER } from "@bosonprotocol/x402-client-fetch";
import type { EscrowPaymentPayload } from "@bosonprotocol/x402-core/schemes/escrow";

const X_PAYMENT_HEADER = "X-PAYMENT";
const RESOURCE_PATH = "/resource";

function newSessionId(): string {
  // Matches the resource server's session-id pattern (`[A-Za-z0-9_-]+`);
  // UUIDs only contain hex + hyphens, so they pass.
  return globalThis.crypto.randomUUID();
}

/** Wire shape of both the structured rejection body and the 200 success body. */
export interface SubmissionBody {
  /** Stable error code (rejections) — e.g. `CALLDATA_MISMATCH`, `FACILITATOR_REJECTED`. */
  code?: string;
  reason?: string;
  details?: {
    rule?: number;
    field?: string;
    expected?: unknown;
    got?: unknown;
    /** Inner facilitator code surfaced under a `FACILITATOR_REJECTED` envelope. */
    facilitatorCode?: string;
  };
  /** Success-body fields (HTTP 200 from /resource). */
  ok?: boolean;
  x402b?: { exchangeId?: string; txHash?: string };
}

export interface CraftedSubmission {
  status: number;
  body: SubmissionBody | null;
}

/** Decode a base64 `X-PAYMENT` header value into the structured payload. */
export function decodePaymentHeader(headerValue: string): EscrowPaymentPayload {
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as EscrowPaymentPayload;
}

/** Re-encode a (possibly mutated) payload back into the base64 header value. */
export function encodePaymentHeader(payload: EscrowPaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/**
 * GET the 402 challenge under `sessionId` and return the escrow
 * `accepts[]` entry (the `EscrowPaymentRequirements`). Throws if the
 * response isn't a 402 or carries no escrow entry.
 */
export async function fetchEscrowChallenge(
  resourceServerUrl: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const res = await globalThis.fetch(`${resourceServerUrl}${RESOURCE_PATH}`, {
    headers: { [SESSION_ID_HEADER]: sessionId },
  });
  if (res.status !== 402) {
    throw new Error(
      `[x402-e2e/craft] expected a 402 challenge, got HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { accepts?: unknown };
  const accepts = Array.isArray(body.accepts) ? body.accepts : [];
  const escrowEntry = accepts.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { scheme?: unknown }).scheme === "escrow",
  );
  if (escrowEntry === undefined) {
    throw new Error(
      `[x402-e2e/craft] 402 challenge carried no escrow accepts[] entry: ${JSON.stringify(body)}`,
    );
  }
  return escrowEntry as Record<string, unknown>;
}

/** Re-issue GET /resource with a crafted `X-PAYMENT` header under `sessionId`. */
export async function submitPaymentHeader(
  resourceServerUrl: string,
  sessionId: string,
  headerValue: string,
): Promise<CraftedSubmission> {
  const res = await globalThis.fetch(`${resourceServerUrl}${RESOURCE_PATH}`, {
    headers: { [SESSION_ID_HEADER]: sessionId, [X_PAYMENT_HEADER]: headerValue },
  });
  const body = (await res.json().catch(() => null)) as SubmissionBody | null;
  return { status: res.status, body };
}

export interface SubmitMutatedCommitArgs {
  resourceServerUrl: string;
  /** Typically `ctx.buyer.client`. */
  client: X402bClient;
  /** In-place mutation of the decoded, otherwise-valid payload. */
  mutate: (payload: EscrowPaymentPayload) => void;
}

/**
 * Build a valid payload from a fresh 402 challenge, apply `mutate`, and
 * submit it. Returns the (expected-rejection) response.
 */
export async function submitMutatedCommit(
  args: SubmitMutatedCommitArgs,
): Promise<CraftedSubmission> {
  const sessionId = newSessionId();
  const escrowEntry = await fetchEscrowChallenge(args.resourceServerUrl, sessionId);
  const headerValue = await args.client.handle402(escrowEntry);
  const payload = decodePaymentHeader(headerValue);
  args.mutate(payload);
  return submitPaymentHeader(args.resourceServerUrl, sessionId, encodePaymentHeader(payload));
}

/**
 * Build one valid `X-PAYMENT` header and return it together with the
 * session id, so a caller can submit the SAME signed payload more than
 * once (used by the nonce-replay scenario C3 — the meta-tx nonce is
 * fixed at sign time, so re-submitting the identical header is what
 * trips the on-chain "nonce already used" guard).
 */
export async function buildValidCommitHeader(
  resourceServerUrl: string,
  client: X402bClient,
): Promise<{ sessionId: string; headerValue: string }> {
  const sessionId = newSessionId();
  const escrowEntry = await fetchEscrowChallenge(resourceServerUrl, sessionId);
  const headerValue = await client.handle402(escrowEntry);
  return { sessionId, headerValue };
}

export interface VerifyViaFacilitatorArgs {
  /** Facilitator service URL (e.g. `http://127.0.0.1:8889`). */
  facilitatorUrl: string;
  /** CAIP-2 network id (e.g. `"eip155:31337"`). */
  network: string;
  payload: EscrowPaymentPayload;
  /** Requirements to send — typically a valid set with one field tampered. */
  requirements: unknown;
}

/**
 * POST a `{ payload, requirements }` pair straight to the facilitator's
 * `/verify` endpoint. Used by C8: the resource server always forwards its
 * own (allowlisted) `escrowAddress`, so the facilitator's allowlist guard
 * can only be exercised by submitting requirements with a non-allowlisted
 * escrow directly. `/verify` returns HTTP 200 on `{ ok: true }`, HTTP 400
 * on `{ ok: false, code, reason }`.
 */
export async function verifyViaFacilitator(
  args: VerifyViaFacilitatorArgs,
): Promise<CraftedSubmission> {
  const url = new URL("/verify", args.facilitatorUrl).toString();
  const res = await globalThis.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scheme: "escrow",
      network: args.network,
      payload: args.payload,
      requirements: args.requirements,
    }),
  });
  const body = (await res.json().catch(() => null)) as SubmissionBody | null;
  return { status: res.status, body };
}

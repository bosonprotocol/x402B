// Channel-aware submitter for buyer-driven post-commit actions.
//
// Given a `NextAction` entry (from a prior server response's
// `nextActions.next[]`) and a signed payload, walk the action's
// advertised `channels` in order, intersected with the channels this
// submitter knows how to drive over HTTP (`server`, `facilitator`).
// Stop at the first 2xx and return the normalized result; treat 5xx /
// network errors / timeouts as a signal to fall back; treat 4xx as
// terminal (a buyer-side payload error fallback can't fix — masking it
// would hide bugs).
//
// `onchain` / `mcp` / `xmtp` channels stay out of this module: the
// onchain submitter needs a wallet client plumbed through client config
// and tx-receipt waiting; the agentic channels need a separate
// `@bosonprotocol/x402-agent` package that isn't shipped. Callers whose
// `action.channels` only list those will hit `NoCompatibleChannelError`.
//
// The server channel returns the rich `{ txHash, nextActions, fulfillment? }`
// envelope; the facilitator's `/perform-action` returns only
// `{ ok: true, txHash, newExchangeState, newDisputeState? }`. The result
// is normalized to the intersection — `nextActions` is surfaced when
// the server channel handled the action, omitted when the facilitator
// did (callers that need a fresh envelope after a facilitator fallback
// can re-derive it server-side or read it from the next response).

import type { EscrowNextActions, NextAction } from "@bosonprotocol/x402-core/schemes/escrow";
import { DisputeState, ExchangeState, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import type { Address, Hex } from "viem";

import type { SignedPostCommitAction } from "./post-commit.js";

/** Channels this submitter drives over HTTP. */
export type SubmitChannel = "server" | "facilitator";

const SUBMIT_CHANNELS: readonly SubmitChannel[] = ["server", "facilitator"];

/**
 * Why a channel attempt didn't yield a 2xx. `"no-endpoint"` is a
 * configuration gap (channel advertised, but no URL listed under
 * `action.endpoints`) — distinct from a real transport-level
 * `"network"` failure so callers branching on `reason` can tell the
 * two apart. `"invalid-response"` covers 2xx replies whose body
 * doesn't match the channel's expected shape — the server replied
 * but with something we can't make sense of, treated as a
 * recoverable failure (the next channel is tried).
 */
export type ChannelFailureReason =
  | "5xx"
  | "4xx"
  | "network"
  | "timeout"
  | "no-endpoint"
  | "invalid-response";

/** Per-channel attempt record — every walk-step appended to `attempts[]`. */
export type ChannelAttempt =
  | { channel: SubmitChannel; ok: true; status: number }
  | {
      channel: SubmitChannel;
      ok: false;
      reason: ChannelFailureReason;
      status?: number;
      message?: string;
    };

/** Caller passes `{ option, data }` for the redeem-only fulfillment payload. */
export interface FulfillmentRequest {
  option: string;
  data: Record<string, unknown> | null;
}

export interface SubmitArgs {
  action: NextAction;
  signed: SignedPostCommitAction;
  exchangeId: string;
  /** CAIP-2 (e.g. `"eip155:31337"`). Required by the facilitator route. */
  network: string;
  /** Escrow contract address. Required by the facilitator route. */
  escrowAddress: Address;
  /** Redeem-only — forwarded to the `server` channel body; ignored by `facilitator`. */
  fulfillment?: FulfillmentRequest;
  /** Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Per-channel timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
}

export interface SubmitResult {
  txHash: Hex;
  newExchangeState: ExchangeState;
  newDisputeState?: DisputeState;
  /** Present only when the `server` channel handled the action. */
  nextActions?: EscrowNextActions;
  channelUsed: SubmitChannel;
  attempts: readonly ChannelAttempt[];
}

/** Thrown when no advertised channel matches one this submitter can drive. */
export class NoCompatibleChannelError extends Error {
  readonly actionId: string;
  readonly advertisedChannels: readonly string[];
  constructor(actionId: string, advertisedChannels: readonly string[]) {
    super(
      `x402-client: action '${actionId}' advertises channels [${advertisedChannels.join(", ")}] but none are submittable over HTTP (server / facilitator).`,
    );
    this.name = "NoCompatibleChannelError";
    this.actionId = actionId;
    this.advertisedChannels = advertisedChannels;
  }
}

/**
 * Thrown when every attempted channel failed. Carries the per-channel
 * attempt log so callers can branch on the final cause (e.g. 4xx from
 * the server → buyer payload bug; 5xx from both → outage).
 */
export class AllChannelsFailedError extends Error {
  readonly attempts: readonly ChannelAttempt[];
  constructor(actionId: string, attempts: readonly ChannelAttempt[]) {
    super(
      `x402-client: action '${actionId}' failed on every attempted channel — ${attempts
        .map((a) => formatAttempt(a))
        .join("; ")}`,
    );
    this.name = "AllChannelsFailedError";
    this.attempts = attempts;
  }
}

function formatAttempt(a: ChannelAttempt): string {
  if (a.ok) return `${a.channel}=ok(${a.status})`;
  const tail = a.status !== undefined ? `(${a.status})` : "";
  return `${a.channel}=${a.reason}${tail}`;
}

/**
 * Submit a signed post-commit action through the first responsive HTTP
 * channel advertised on `action.channels`. Returns the normalized result
 * on first 2xx; throws `NoCompatibleChannelError` when no submittable
 * channel is advertised, or `AllChannelsFailedError` when every attempt
 * failed.
 */
export async function submitAction(args: SubmitArgs): Promise<SubmitResult> {
  const fetcher = args.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = args.timeoutMs ?? 10_000;

  const ordered = orderedChannels(args.action);
  if (ordered.length === 0) {
    throw new NoCompatibleChannelError(args.action.id, args.action.channels);
  }

  const attempts: ChannelAttempt[] = [];
  for (const channel of ordered) {
    const endpoint = args.action.endpoints?.[channel];
    if (endpoint === undefined) {
      attempts.push({
        channel,
        ok: false,
        reason: "no-endpoint",
        message: `no endpoint advertised for channel '${channel}'`,
      });
      continue;
    }

    const outcome = await attemptChannel({
      channel,
      endpoint,
      args,
      fetcher,
      timeoutMs,
    });
    attempts.push(outcome.attempt);

    if (outcome.attempt.ok && outcome.result !== undefined) {
      return { ...outcome.result, attempts };
    }
    if (!outcome.attempt.ok && outcome.attempt.reason === "4xx") {
      // 4xx is a buyer-payload error — no fallback can fix it; surface it.
      throw new AllChannelsFailedError(args.action.id, attempts);
    }
  }

  throw new AllChannelsFailedError(args.action.id, attempts);
}

function orderedChannels(action: NextAction): SubmitChannel[] {
  const seen = new Set<SubmitChannel>();
  const out: SubmitChannel[] = [];
  for (const c of action.channels) {
    if ((SUBMIT_CHANNELS as readonly string[]).includes(c) && !seen.has(c as SubmitChannel)) {
      seen.add(c as SubmitChannel);
      out.push(c as SubmitChannel);
    }
  }
  return out;
}

interface AttemptOutcome {
  attempt: ChannelAttempt;
  /** Set when `attempt.ok === true`. */
  result?: Omit<SubmitResult, "attempts">;
}

async function attemptChannel(input: {
  channel: SubmitChannel;
  endpoint: string;
  args: SubmitArgs;
  fetcher: typeof globalThis.fetch;
  timeoutMs: number;
}): Promise<AttemptOutcome> {
  const { channel, endpoint, args, fetcher, timeoutMs } = input;

  const body = channel === "server" ? buildServerBody(args) : buildFacilitatorBody(args);

  let res: Response;
  try {
    res = await fetchWithTimeout(fetcher, endpoint, body, timeoutMs);
  } catch (e) {
    const reason = isTimeout(e) ? "timeout" : "network";
    return {
      attempt: {
        channel,
        ok: false,
        reason,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const parsed = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 500) {
    return {
      attempt: { channel, ok: false, reason: "5xx", status: res.status },
    };
  }
  if (!res.ok) {
    return {
      attempt: { channel, ok: false, reason: "4xx", status: res.status },
    };
  }
  if (parsed === null || typeof parsed !== "object") {
    return {
      attempt: {
        channel,
        ok: false,
        reason: "invalid-response",
        status: res.status,
        message: "response body is not a JSON object",
      },
    };
  }

  try {
    const result =
      channel === "server" ? parseServerResult(parsed) : parseFacilitatorResult(parsed);
    return {
      attempt: { channel, ok: true, status: res.status },
      result: { ...result, channelUsed: channel },
    };
  } catch (e) {
    // 2xx body parsed as JSON but doesn't match the expected shape — the
    // server replied with something we can't make sense of. Treat as
    // recoverable so the next channel gets a chance (vs. a 4xx, which
    // is terminal because no other channel can fix the buyer's payload).
    return {
      attempt: {
        channel,
        ok: false,
        reason: "invalid-response",
        status: res.status,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

function buildServerBody(args: SubmitArgs): unknown {
  const body: Record<string, unknown> = {
    exchangeId: args.exchangeId,
    signedPayload: args.signed.signedPayload,
  };
  if (args.action.id === "boson-redeem" && args.fulfillment !== undefined) {
    body.fulfillment = args.fulfillment;
  }
  return body;
}

function buildFacilitatorBody(args: SubmitArgs): unknown {
  return {
    action: args.action.id as ActionId,
    exchangeId: args.exchangeId,
    network: args.network,
    escrowAddress: args.escrowAddress,
    signedPayload: args.signed.signedPayload,
  };
}

async function fetchWithTimeout(
  fetcher: typeof globalThis.fetch,
  endpoint: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs);
  try {
    return await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

class TimeoutError extends Error {
  readonly isTimeout = true as const;
  constructor(timeoutMs: number) {
    super(`x402-client/submit: channel attempt timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

function isTimeout(e: unknown): boolean {
  if (e instanceof TimeoutError) return true;
  if (typeof e !== "object" || e === null) return false;
  const obj = e as { name?: unknown; isTimeout?: unknown; cause?: unknown };
  if (obj.isTimeout === true) return true;
  if (obj.name === "AbortError" || obj.name === "TimeoutError") return true;
  // `AbortController.abort(reason)` surfaces the reason on `.cause` for
  // fetch implementations that wrap it; check one level deep.
  if (typeof obj.cause === "object" && obj.cause !== null) {
    const cause = obj.cause as { isTimeout?: unknown; name?: unknown };
    if (cause.isTimeout === true) return true;
    if (cause.name === "TimeoutError") return true;
  }
  return false;
}

function parseServerResult(body: unknown): Omit<SubmitResult, "attempts" | "channelUsed"> {
  if (typeof body !== "object" || body === null) {
    throw new Error("server response body is not an object");
  }
  const raw = body as {
    txHash?: unknown;
    nextActions?: {
      exchangeState?: unknown;
      disputeState?: unknown;
      next?: unknown;
      exchangeId?: unknown;
      fallback?: unknown;
    };
  };
  const txHash = raw.txHash;
  const exchangeState = raw.nextActions?.exchangeState;
  if (typeof txHash !== "string" || !isExchangeState(exchangeState)) {
    throw new Error("server response missing txHash or nextActions.exchangeState");
  }
  const out: Omit<SubmitResult, "attempts" | "channelUsed"> = {
    txHash: txHash as Hex,
    newExchangeState: exchangeState,
    nextActions: raw.nextActions as EscrowNextActions,
  };
  if (isDisputeState(raw.nextActions?.disputeState)) {
    out.newDisputeState = raw.nextActions.disputeState;
  }
  return out;
}

function parseFacilitatorResult(body: unknown): Omit<SubmitResult, "attempts" | "channelUsed"> {
  if (typeof body !== "object" || body === null) {
    throw new Error("facilitator response body is not an object");
  }
  const raw = body as {
    ok?: unknown;
    txHash?: unknown;
    newExchangeState?: unknown;
    newDisputeState?: unknown;
  };
  if (raw.ok !== true || typeof raw.txHash !== "string" || !isExchangeState(raw.newExchangeState)) {
    throw new Error("facilitator response missing ok/txHash/newExchangeState");
  }
  const out: Omit<SubmitResult, "attempts" | "channelUsed"> = {
    txHash: raw.txHash as Hex,
    newExchangeState: raw.newExchangeState,
  };
  if (isDisputeState(raw.newDisputeState)) {
    out.newDisputeState = raw.newDisputeState;
  }
  return out;
}

function isExchangeState(v: unknown): v is ExchangeState {
  return typeof v === "string" && (Object.values(ExchangeState) as string[]).includes(v);
}

function isDisputeState(v: unknown): v is DisputeState {
  return typeof v === "string" && (Object.values(DisputeState) as string[]).includes(v);
}

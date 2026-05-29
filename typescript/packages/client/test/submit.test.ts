// Unit tests for the channel-aware post-commit submitter.
//
// Drives `submitAction` against a vi-mocked fetch and verifies:
//   - server-channel happy path (single attempt, full envelope surfaced),
//   - 5xx on server triggers facilitator fallback,
//   - 4xx on server is terminal (no fallback),
//   - timeout / network error triggers fallback,
//   - no-compatible-channel + all-channels-failed errors,
//   - body shape per channel (server expects { exchangeId, signedPayload };
//     facilitator expects the envelope with `action` + `network` + …),
//   - redeem-only fulfillment payload only goes on the server-channel body.

import type { NextAction } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it, vi } from "vitest";

import type { SignedPostCommitAction } from "../src/post-commit.js";
import {
  AllChannelsFailedError,
  NoCompatibleChannelError,
  submitAction,
  type SubmitArgs,
} from "../src/submit.js";

const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const NETWORK = "eip155:31337";
const EXCHANGE_ID = "42";

const SERVER_URL = "https://server.example/x402B/redeem";
const FACILITATOR_URL = "https://facilitator.example/perform-action?action=boson-redeem";

const SIGNED: SignedPostCommitAction = {
  metaTx: {
    from: "0x2222222222222222222222222222222222222222",
    nonce: "1",
    functionName: "redeemVoucher(uint256)",
    functionSignature: "0xdeadbeef",
    sig: { v: 27, r: `0x${"01".repeat(32)}`, s: `0x${"02".repeat(32)}` },
  },
  signedPayload: `0x${"cd".repeat(64)}`,
};

function makeAction(overrides: Partial<NextAction> = {}): NextAction {
  return {
    id: "boson-redeem",
    channels: ["server", "facilitator"],
    endpoints: { server: SERVER_URL, facilitator: FACILITATOR_URL },
    ...overrides,
  };
}

function makeArgs(overrides: Partial<SubmitArgs> = {}): SubmitArgs {
  return {
    action: makeAction(),
    signed: SIGNED,
    exchangeId: EXCHANGE_ID,
    network: NETWORK,
    escrowAddress: ESCROW,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SERVER_OK_BODY = {
  txHash: `0x${"ab".repeat(32)}`,
  nextActions: {
    exchangeId: EXCHANGE_ID,
    exchangeState: "REDEEMED",
    next: [{ id: "boson-completeExchange", channels: ["server"] }],
  },
};

const FACILITATOR_OK_BODY = {
  ok: true,
  txHash: `0x${"ab".repeat(32)}`,
  newExchangeState: "REDEEMED",
};

describe("submitAction", () => {
  it("server channel 2xx → returns normalized result with nextActions and channelUsed='server'", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, SERVER_OK_BODY));
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(SERVER_URL);
    expect(result.channelUsed).toBe("server");
    expect(result.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(result.newExchangeState).toBe("REDEEMED");
    expect(result.nextActions).toBeDefined();
    expect(result.attempts).toEqual([{ channel: "server", ok: true, status: 200 }]);
  });

  it("server channel 5xx → falls back to facilitator and surfaces facilitator result", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) return jsonResponse(502, { code: "BAD_GATEWAY" });
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.channelUsed).toBe("facilitator");
    expect(result.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(result.newExchangeState).toBe("REDEEMED");
    // Facilitator route doesn't emit nextActions; result.nextActions stays unset.
    expect(result.nextActions).toBeUndefined();
    expect(result.attempts).toEqual([
      { channel: "server", ok: false, reason: "5xx", status: 502 },
      { channel: "facilitator", ok: true, status: 200 },
    ]);
  });

  it("server channel 4xx → terminal (no fallback), throws AllChannelsFailedError", async () => {
    const fetcher = vi.fn(async () => jsonResponse(400, { code: "BAD_PAYLOAD" }));
    await expect(
      submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch })),
    ).rejects.toBeInstanceOf(AllChannelsFailedError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("server channel network error → falls back to facilitator", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(result.channelUsed).toBe("facilitator");
    expect(result.attempts[0]).toMatchObject({
      channel: "server",
      ok: false,
      reason: "network",
    });
  });

  it("both channels 5xx → throws AllChannelsFailedError with both attempt records", async () => {
    const fetcher = vi.fn(async () => jsonResponse(503, { code: "DOWN" }));
    await expect(
      submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch })),
    ).rejects.toBeInstanceOf(AllChannelsFailedError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("action advertises only non-HTTP channels → throws NoCompatibleChannelError without calling fetch", async () => {
    const fetcher = vi.fn();
    await expect(
      submitAction(
        makeArgs({
          action: makeAction({ channels: ["mcp", "onchain"] }),
          fetch: fetcher as unknown as typeof fetch,
        }),
      ),
    ).rejects.toBeInstanceOf(NoCompatibleChannelError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("channel advertised without an endpoint → skipped, attempt logged, fallback proceeds", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, FACILITATOR_OK_BODY));
    const result = await submitAction(
      makeArgs({
        action: makeAction({ endpoints: { facilitator: FACILITATOR_URL } }),
        fetch: fetcher as unknown as typeof fetch,
      }),
    );
    expect(result.channelUsed).toBe("facilitator");
    expect(result.attempts[0]).toMatchObject({
      channel: "server",
      ok: false,
      reason: "no-endpoint",
    });
  });

  it("server channel body contains exchangeId + signedPayload (and fulfillment when provided)", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, SERVER_OK_BODY));
    await submitAction(
      makeArgs({
        fulfillment: { option: "inline", data: { foo: "bar" } },
        fetch: fetcher as unknown as typeof fetch,
      }),
    );
    const req = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(req.body))).toEqual({
      exchangeId: EXCHANGE_ID,
      signedPayload: SIGNED.signedPayload,
      fulfillment: { option: "inline", data: { foo: "bar" } },
    });
  });

  it("facilitator channel body contains action + network + escrowAddress + signedPayload (no fulfillment)", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) return jsonResponse(500, {});
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    await submitAction(
      makeArgs({
        fulfillment: { option: "inline", data: { foo: "bar" } },
        fetch: fetcher as unknown as typeof fetch,
      }),
    );
    const facilitatorCall = fetcher.mock.calls.find((c) => String(c[0]) === FACILITATOR_URL);
    expect(facilitatorCall).toBeDefined();
    const req = facilitatorCall![1] as RequestInit;
    expect(JSON.parse(String(req.body))).toEqual({
      action: "boson-redeem",
      exchangeId: EXCHANGE_ID,
      network: NETWORK,
      escrowAddress: ESCROW,
      signedPayload: SIGNED.signedPayload,
    });
  });

  it("DISPUTED post-commit response surfaces newDisputeState", async () => {
    const body = {
      txHash: `0x${"cd".repeat(32)}`,
      nextActions: {
        exchangeId: EXCHANGE_ID,
        exchangeState: "DISPUTED",
        disputeState: "RESOLVING",
        next: [{ id: "boson-retractDispute", channels: ["server"] }],
      },
    };
    const fetcher = vi.fn(async () => jsonResponse(200, body));
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(result.newExchangeState).toBe("DISPUTED");
    expect(result.newDisputeState).toBe("RESOLVING");
  });

  it("server 2xx with body of wrong shape → reason='invalid-response', falls back to facilitator", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) {
        // 200 with a JSON object that's missing txHash + nextActions.
        return jsonResponse(200, { unexpected: true });
      }
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(result.channelUsed).toBe("facilitator");
    expect(result.attempts[0]).toMatchObject({
      channel: "server",
      ok: false,
      reason: "invalid-response",
      status: 200,
    });
  });

  it("server 2xx with non-hex txHash → reason='invalid-response', falls back to facilitator", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) {
        return jsonResponse(200, {
          txHash: "not-a-hex-hash",
          nextActions: {
            exchangeId: EXCHANGE_ID,
            exchangeState: "REDEEMED",
            next: [],
          },
        });
      }
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(result.channelUsed).toBe("facilitator");
    expect(result.attempts[0]).toMatchObject({
      channel: "server",
      ok: false,
      reason: "invalid-response",
      status: 200,
    });
  });

  it("server 2xx with non-object body → reason='invalid-response', falls back to facilitator", async () => {
    const fetcher = vi.fn(async (input: RequestInfo) => {
      if (String(input) === SERVER_URL) {
        return new Response('"a-string"', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    const result = await submitAction(makeArgs({ fetch: fetcher as unknown as typeof fetch }));
    expect(result.channelUsed).toBe("facilitator");
    expect(result.attempts[0]).toMatchObject({
      channel: "server",
      ok: false,
      reason: "invalid-response",
      status: 200,
    });
  });

  it("respects the seller's advertised channel order (facilitator first, then server)", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo) => {
      calls.push(String(input));
      return jsonResponse(200, FACILITATOR_OK_BODY);
    });
    await submitAction(
      makeArgs({
        action: makeAction({ channels: ["facilitator", "server"] }),
        fetch: fetcher as unknown as typeof fetch,
      }),
    );
    expect(calls[0]).toBe(FACILITATOR_URL);
  });
});

// Unit tests for the entity-keyed handlers introduced alongside
// `boson-withdrawFunds`: `handleWithdrawFunds`, `handleGetAvailableFunds`,
// and the shared `resolveEntityId` helper. Each test stubs the
// facilitator + core-sdk-read surface directly so we exercise the
// dispatch logic without needing a full server.

import { describe, expect, it, vi } from "vitest";

import type {
  AvailableFundsContext,
  CoreSdkReadAdapter,
  FacilitatorClient,
  WithdrawFundsContext,
} from "../src/index.js";
import { FacilitatorHttpError } from "../src/index.js";
import { handleGetAvailableFunds } from "../src/handlers/available-funds.js";
import { handleWithdrawFunds } from "../src/handlers/withdraw-funds.js";
import { resolveEntityId } from "../src/handlers/resolve-entity.js";
import { CHAIN_ID, ESCROW, NETWORK } from "./fixtures.js";

const ENTITY_ID = "42";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNED_PAYLOAD = `0x${"ab".repeat(96)}` as const;

function makeCoreSdkRead(overrides: Partial<CoreSdkReadAdapter> = {}): CoreSdkReadAdapter {
  return {
    getFunds: vi.fn(async () => []),
    getSellersByAddress: vi.fn(async () => []),
    getBuyers: vi.fn(async () => []),
    ...overrides,
  };
}

function makeFacilitator(result: unknown): FacilitatorClient {
  return {
    verify: vi.fn(),
    settle: vi.fn(),
    performAction: vi.fn(async () => result as never),
  } as unknown as FacilitatorClient;
}

const SERVER_CONFIG = {
  network: NETWORK,
  chainId: CHAIN_ID,
  escrow: ESCROW,
  signer: { address: ESCROW, signTypedData: async () => "0x00" },
  facilitator: { url: "https://facilitator.example" },
  channelRegistry: { channels: ["server"], escrow: ESCROW },
} as unknown as WithdrawFundsContext["config"];

describe("resolveEntityId", () => {
  it("returns the seller id when the address only matches a seller", async () => {
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: vi.fn(async () => [{ id: "1" }]),
    });
    const result = await resolveEntityId(coreSdk, { address: ADDRESS });
    expect(result).toEqual({ ok: true, entityId: "1", role: "seller" });
  });

  it("returns the buyer id when the address only matches a buyer", async () => {
    const coreSdk = makeCoreSdkRead({
      getBuyers: vi.fn(async () => [{ id: "9" }]),
    });
    const result = await resolveEntityId(coreSdk, { address: ADDRESS });
    expect(result).toEqual({ ok: true, entityId: "9", role: "buyer" });
  });

  it("returns AMBIGUOUS with both ids when role is omitted and both match", async () => {
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: vi.fn(async () => [{ id: "1" }]),
      getBuyers: vi.fn(async () => [{ id: "9" }]),
    });
    const result = await resolveEntityId(coreSdk, { address: ADDRESS });
    expect(result).toMatchObject({ ok: false, code: "AMBIGUOUS", sellerId: "1", buyerId: "9" });
  });

  it("respects an explicit role and skips the other lookup", async () => {
    const buyerStub = vi.fn(async () => [{ id: "9" }]);
    const sellerStub = vi.fn(async () => [{ id: "1" }]);
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: sellerStub,
      getBuyers: buyerStub,
    });
    const result = await resolveEntityId(coreSdk, { address: ADDRESS, role: "buyer" });
    expect(result).toEqual({ ok: true, entityId: "9", role: "buyer" });
    expect(sellerStub).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when no entity matches", async () => {
    const coreSdk = makeCoreSdkRead();
    const result = await resolveEntityId(coreSdk, { address: ADDRESS });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("returns SUBGRAPH_FAILURE when a lookup throws", async () => {
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: vi.fn(async () => {
        throw new Error("subgraph down");
      }),
    });
    const result = await resolveEntityId(coreSdk, { address: ADDRESS });
    expect(result).toMatchObject({ ok: false, code: "SUBGRAPH_FAILURE" });
  });

  it("lowercases the address before passing it to the subgraph", async () => {
    const upper = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
    const buyerStub = vi.fn(async () => [{ id: "9" }]);
    const coreSdk = makeCoreSdkRead({ getBuyers: buyerStub });
    await resolveEntityId(coreSdk, { address: upper });
    expect(buyerStub).toHaveBeenCalledWith({ buyersFilter: { wallet: upper.toLowerCase() } });
  });
});

describe("handleGetAvailableFunds", () => {
  function makeCtx(coreSdkRead: CoreSdkReadAdapter): AvailableFundsContext {
    return { coreSdkRead };
  }

  it("happy path by entityId — reshapes subgraph funds into the response body", async () => {
    const coreSdk = makeCoreSdkRead({
      getFunds: vi.fn(async () => [
        {
          accountId: ENTITY_ID,
          availableAmount: "1500000",
          token: {
            address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            decimals: "6",
            symbol: "USDC",
            name: "USD Coin",
          },
        },
      ]),
    });
    const result = await handleGetAvailableFunds({ entityId: ENTITY_ID }, makeCtx(coreSdk));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({
        entityId: ENTITY_ID,
        funds: [
          {
            tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            tokenSymbol: "USDC",
            tokenName: "USD Coin",
            decimals: 6,
            availableAmount: "1500000",
          },
        ],
      });
    }
  });

  it("400 when entityId is malformed", async () => {
    const result = await handleGetAvailableFunds({ entityId: "0xabc" }, makeCtx(makeCoreSdkRead()));
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: "INVALID_ENTITY_ID" } });
  });

  it("400 when address is malformed", async () => {
    const result = await handleGetAvailableFunds(
      { address: "not-an-address" },
      makeCtx(makeCoreSdkRead()),
    );
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: "INVALID_ADDRESS" } });
  });

  it("404 when address resolves to no entity", async () => {
    const result = await handleGetAvailableFunds({ address: ADDRESS }, makeCtx(makeCoreSdkRead()));
    expect(result).toMatchObject({ ok: false, status: 404, body: { code: "NOT_FOUND" } });
  });

  it("409 when address resolves to both roles and role is omitted", async () => {
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: vi.fn(async () => [{ id: "1" }]),
      getBuyers: vi.fn(async () => [{ id: "9" }]),
    });
    const result = await handleGetAvailableFunds({ address: ADDRESS }, makeCtx(coreSdk));
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "AMBIGUOUS", details: { sellerId: "1", buyerId: "9" } },
    });
  });

  it("502 when the subgraph getFunds call throws", async () => {
    const coreSdk = makeCoreSdkRead({
      getFunds: vi.fn(async () => {
        throw new Error("subgraph 500");
      }),
    });
    const result = await handleGetAvailableFunds({ entityId: ENTITY_ID }, makeCtx(coreSdk));
    expect(result).toMatchObject({ ok: false, status: 502, body: { code: "SUBGRAPH_FAILURE" } });
  });

  it("returns role in the response body when looked up by address", async () => {
    const coreSdk = makeCoreSdkRead({
      getSellersByAddress: vi.fn(async () => [{ id: "1" }]),
      getFunds: vi.fn(async () => []),
    });
    const result = await handleGetAvailableFunds({ address: ADDRESS }, makeCtx(coreSdk));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.entityId).toBe("1");
      expect(result.body.role).toBe("seller");
    }
  });
});

describe("handleWithdrawFunds", () => {
  function makeCtx(
    facilitatorResult: unknown,
    coreSdkRead?: CoreSdkReadAdapter,
  ): WithdrawFundsContext {
    return {
      config: SERVER_CONFIG,
      facilitator: makeFacilitator(facilitatorResult),
      coreSdkRead: coreSdkRead ?? makeCoreSdkRead(),
    };
  }

  it("happy path by entityId — forwards to facilitator and returns txHash", async () => {
    const ctx = makeCtx({ ok: true, txHash: "0xdeadbeef" });
    const result = await handleWithdrawFunds(
      { entityId: ENTITY_ID, signedPayload: SIGNED_PAYLOAD },
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { txHash: "0xdeadbeef", entityId: ENTITY_ID },
    });
    expect(ctx.facilitator.performAction).toHaveBeenCalledWith({
      network: NETWORK,
      escrowAddress: ESCROW,
      entityId: ENTITY_ID,
      action: "boson-withdrawFunds",
      signedPayload: SIGNED_PAYLOAD,
    });
  });

  it("happy path by address — resolves and echoes role", async () => {
    const coreSdk = makeCoreSdkRead({
      getBuyers: vi.fn(async () => [{ id: "9" }]),
    });
    const ctx = makeCtx({ ok: true, txHash: "0xdeadbeef" }, coreSdk);
    const result = await handleWithdrawFunds(
      { address: ADDRESS, signedPayload: SIGNED_PAYLOAD },
      ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      body: { txHash: "0xdeadbeef", entityId: "9", role: "buyer" },
    });
  });

  it("400 when entityId is malformed", async () => {
    const ctx = makeCtx({ ok: true, txHash: "0x..." });
    const result = await handleWithdrawFunds(
      { entityId: "abc", signedPayload: SIGNED_PAYLOAD },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: "INVALID_ENTITY_ID" } });
    expect(ctx.facilitator.performAction).not.toHaveBeenCalled();
  });

  it("502 with FACILITATOR_REJECTED when the facilitator returns ok: false", async () => {
    const ctx = makeCtx({ ok: false, code: "ONCHAIN_REVERT", reason: "fund balance too low" });
    const result = await handleWithdrawFunds(
      { entityId: ENTITY_ID, signedPayload: SIGNED_PAYLOAD },
      ctx,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      body: { code: "FACILITATOR_REJECTED", details: { facilitatorCode: "ONCHAIN_REVERT" } },
    });
  });

  it("502 with FACILITATOR_UNREACHABLE when the facilitator client throws", async () => {
    const facilitator = {
      verify: vi.fn(),
      settle: vi.fn(),
      performAction: vi.fn(async () => {
        throw new FacilitatorHttpError("facilitator HTTP 503 (/perform-action)", {
          code: "BAD_HTTP_STATUS",
          status: 503,
        });
      }),
    } as unknown as FacilitatorClient;
    const ctx: WithdrawFundsContext = {
      config: SERVER_CONFIG,
      facilitator,
      coreSdkRead: makeCoreSdkRead(),
    };
    const result = await handleWithdrawFunds(
      { entityId: ENTITY_ID, signedPayload: SIGNED_PAYLOAD },
      ctx,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      body: { code: "FACILITATOR_UNREACHABLE" },
    });
  });
});

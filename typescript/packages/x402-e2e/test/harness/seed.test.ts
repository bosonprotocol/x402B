// Unit tests for the suite-level seed step. Mocks the CoreSDK +
// subgraph adapter so no Docker / no real subgraph is needed.

import { describe, expect, it, vi } from "vitest";

import { LOCAL_31337_0 } from "../../src/config/local-31337-0.js";
import { seedSuite } from "../../src/harness/seed.js";

const SELLER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

// `seedSuite` constructs its own `CoreSDK` and casts it via
// `asCoreSdkReadAdapter`. Mock the CoreSDK constructor to return a
// minimal stub that satisfies `CoreSdkReadAdapter`. Per-test override
// of the stub's behaviour lives in `vi.mocked(...)`.
const coreSdkStub = {
  getSellersByAddress: vi.fn(),
  getBuyers: vi.fn(),
  getFunds: vi.fn(),
};

// `x402-core` transitively imports `subgraph` from `core-sdk` (for the
// `ExchangeState` / `DisputeState` enum values), so the mock must
// preserve the original exports and only swap `CoreSDK`.
vi.mock("@bosonprotocol/core-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bosonprotocol/core-sdk")>();
  return {
    ...actual,
    CoreSDK: vi.fn().mockImplementation(() => coreSdkStub),
  };
});

describe("seedSuite", () => {
  it("returns the existing seller id when the subgraph already has one", async () => {
    coreSdkStub.getSellersByAddress.mockResolvedValueOnce([{ id: "7" }]);
    const result = await seedSuite({ sellerAddress: SELLER_ADDRESS });
    expect(result.seller).toEqual({ id: "7", assistant: SELLER_ADDRESS });
    expect(result.disputeResolverId).toBe(LOCAL_31337_0.defaultDisputeResolverId);
  });

  it("throws when no seller exists and no createSeller callback is supplied", async () => {
    coreSdkStub.getSellersByAddress.mockResolvedValueOnce([]);
    await expect(seedSuite({ sellerAddress: SELLER_ADDRESS })).rejects.toThrow(
      /no seller registered/,
    );
  });

  it("invokes the callback, then polls the subgraph for the new seller", async () => {
    coreSdkStub.getSellersByAddress
      .mockResolvedValueOnce([]) // initial check — none
      .mockResolvedValueOnce([]) // first post-create poll — indexer still catching up
      .mockResolvedValueOnce([{ id: "11" }]); // second post-create poll — indexed

    const createSeller = vi.fn().mockResolvedValue(undefined);

    const result = await seedSuite({
      sellerAddress: SELLER_ADDRESS,
      createSeller,
      postCreatePollAttempts: 5,
      postCreatePollIntervalMs: 1,
    });

    expect(createSeller).toHaveBeenCalledWith(SELLER_ADDRESS);
    expect(result.seller.id).toBe("11");
  });

  it("throws when the seller still isn't indexed after the retry budget", async () => {
    coreSdkStub.getSellersByAddress.mockResolvedValue([]);
    const createSeller = vi.fn().mockResolvedValue(undefined);

    await expect(
      seedSuite({
        sellerAddress: SELLER_ADDRESS,
        createSeller,
        postCreatePollAttempts: 2,
        postCreatePollIntervalMs: 1,
      }),
    ).rejects.toThrow(/never indexed/);
  });
});

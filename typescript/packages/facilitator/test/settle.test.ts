import { abis } from "@bosonprotocol/common";
import { describe, expect, it } from "vitest";
import {
  BaseError,
  InsufficientFundsError,
  RawContractError,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";

import { settle } from "../src/settle/index.js";
import type { FacilitatorConfig } from "../src/types.js";

import {
  AMOUNT,
  ASSET,
  buildValidPayload,
  buildValidRequirements,
  buyer,
  CHAIN_ID,
  ESCROW,
  NETWORK,
  relayer,
} from "./fixtures.js";

const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const EXPECTED_EXCHANGE_ID = 42n;

/**
 * Build a synthetic receipt with one BuyerCommitted log. Encodes the
 * indexed `exchangeId` into topic[3] so viem's parseEventLogs finds it.
 */
function buildReceipt(
  opts: {
    status?: "success" | "reverted";
    withBuyerCommitted?: boolean;
  } = {},
): TransactionReceipt {
  const status = opts.status ?? "success";
  const withBuyerCommitted = opts.withBuyerCommitted ?? true;
  const topics = withBuyerCommitted
    ? encodeEventTopics({
        abi: abis.IBosonExchangeHandlerABI as readonly unknown[],
        eventName: "BuyerCommitted",
        args: {
          offerId: 1n,
          buyerId: 2n,
          exchangeId: EXPECTED_EXCHANGE_ID,
        },
      })
    : [keccak256(toBytes("UnrelatedEvent(uint256)"))];
  // Non-indexed args of BuyerCommitted: (Exchange exchange, Voucher
  // voucher, address executedBy). The struct shapes come from
  // @bosonprotocol/common's IBosonExchangeHandler ABI.
  const nonIndexedData = withBuyerCommitted
    ? encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "id", type: "uint256" },
              { name: "offerId", type: "uint256" },
              { name: "buyerId", type: "uint256" },
              { name: "finalizedDate", type: "uint256" },
              { name: "state", type: "uint8" },
              { name: "mutualizerAddress", type: "address" },
            ],
          },
          {
            type: "tuple",
            components: [
              { name: "committedDate", type: "uint256" },
              { name: "validUntilDate", type: "uint256" },
              { name: "redeemedDate", type: "uint256" },
              { name: "expired", type: "bool" },
            ],
          },
          { type: "address" },
        ],
        [
          {
            id: EXPECTED_EXCHANGE_ID,
            offerId: 1n,
            buyerId: 2n,
            finalizedDate: 0n,
            state: 0,
            mutualizerAddress: "0x0000000000000000000000000000000000000000",
          },
          {
            committedDate: 1700000000n,
            validUntilDate: 1800000000n,
            redeemedDate: 0n,
            expired: false,
          },
          relayer.address,
        ],
      )
    : "0x";
  return {
    transactionHash: TX_HASH,
    status,
    logs: withBuyerCommitted
      ? [
          {
            address: ESCROW,
            topics,
            data: nonIndexedData,
            blockNumber: 1n,
            transactionIndex: 0,
            logIndex: 0,
            blockHash: `0x${"00".repeat(32)}`,
            transactionHash: TX_HASH,
            removed: false,
          },
        ]
      : [],
  } as unknown as TransactionReceipt;
}

function buildPublicClient(
  opts: {
    callBehavior?: "pass" | "revert";
    receipt?: TransactionReceipt;
    waitBehavior?: "ok" | "timeout";
  } = {},
): PublicClient {
  return {
    call: async () => {
      if (opts.callBehavior === "revert") {
        // Match viem's actual error shape: a BaseError whose cause
        // chain contains a RawContractError. simulate.ts's
        // isOnChainRevert walks the chain looking for this marker to
        // distinguish a real revert from a transport-layer failure.
        const cause = new RawContractError({ message: "execution reverted: simulated revert" });
        throw new BaseError("Execution reverted", { cause });
      }
      return { data: "0x" };
    },
    readContract: async () => {
      throw new Error("readContract not stubbed");
    },
    waitForTransactionReceipt: async () => {
      if (opts.waitBehavior === "timeout") {
        // viem rejects waitForTransactionReceipt with a typed error on
        // poll timeout (WaitForTransactionReceiptTimeoutError) — a
        // BaseError subclass. Mimic that shape so submit() exercises
        // its catch branch.
        throw new BaseError("Timed out while waiting for transaction receipt", {
          cause: new Error("poll deadline exceeded after 30s"),
        });
      }
      return opts.receipt ?? buildReceipt();
    },
  } as unknown as PublicClient;
}

function buildWalletClient(
  opts: { sendBehavior?: "pass" | "fail" | "insufficient-funds" } = {},
): WalletClient {
  return {
    account: { address: relayer.address, type: "json-rpc" },
    chain: {
      id: CHAIN_ID,
      name: "test",
      nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
      rpcUrls: { default: { http: [] } },
    },
    sendTransaction: async () => {
      if (opts.sendBehavior === "fail") throw new Error("RPC unreachable");
      if (opts.sendBehavior === "insufficient-funds") throw new InsufficientFundsError();
      return TX_HASH;
    },
  } as unknown as WalletClient;
}

function buildConfig(
  opts: { publicClient?: PublicClient; walletClient?: WalletClient } = {},
): FacilitatorConfig {
  return {
    url: "https://facilitator.example",
    supportedNetworks: [NETWORK],
    escrows: { [NETWORK]: ESCROW },
    walletClient: opts.walletClient ?? buildWalletClient(),
    publicClient: opts.publicClient ?? buildPublicClient(),
  };
}

describe("settle()", () => {
  it("happy path: verify passes, envelope built, tx submitted, exchangeId extracted", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toEqual({
      ok: true,
      exchangeId: EXPECTED_EXCHANGE_ID.toString(),
      txHash: TX_HASH,
    });
  });

  it("re-emits verify failure when network is wrong", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const result = await settle(
      { scheme: "escrow", network: "eip155:137", payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
  });

  it("re-emits verify failure when simulation reverts", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      publicClient: buildPublicClient({ callBehavior: "revert" }),
    });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "SIMULATION_REVERT" });
  });

  // The non-"none" token-auth path through settle requires a real
  // signed Permit / ERC-3009 / Permit2 payload AND a working
  // publicClient.readContract for the token-domain lookup. We exercise
  // verify's signature-recovery on its own in verify.test.ts (including
  // the happy-path BPIP-12 simulation for Permit2) and the
  // `buildSettleEnvelope` describe block below covers the calldata-build
  // side without a real anvil fork.

  it("returns ONCHAIN_REVERT when receipt status is reverted", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      publicClient: buildPublicClient({
        receipt: buildReceipt({ status: "reverted" }),
      }),
    });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "ONCHAIN_REVERT" });
  });

  it("returns EVENT_NOT_FOUND when receipt has no BuyerCommitted log", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      publicClient: buildPublicClient({
        receipt: buildReceipt({ withBuyerCommitted: false }),
      }),
    });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "EVENT_NOT_FOUND" });
  });

  it("returns INTERNAL_ERROR when sendTransaction fails before broadcast", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({ walletClient: buildWalletClient({ sendBehavior: "fail" }) });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });

  it("returns INTERNAL_ERROR when waitForTransactionReceipt times out", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      publicClient: buildPublicClient({ waitBehavior: "timeout" }),
    });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect((result as { ok: false; reason: string }).reason).toContain("waitForTransactionReceipt");
  });

  it("returns INSUFFICIENT_FUNDS_FOR_GAS when the relayer cannot fund gas", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      walletClient: buildWalletClient({ sendBehavior: "insufficient-funds" }),
    });
    const result = await settle(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_FUNDS_FOR_GAS" });
  });
});

describe("buildSettleEnvelope", () => {
  it("returns INVALID_PAYLOAD when a non-none strategy is requested but tokenAuth is missing", async () => {
    const { buildSettleEnvelope } = await import("../src/settle/build-envelope.js");
    const result = buildSettleEnvelope({
      escrowAddress: ESCROW,
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: "1",
        functionName: "foo()",
        functionSignature: "0xdeadbeef",
        sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
      },
      strategy: "erc3009",
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("returns a TxRequest for tokenAuthStrategy 'permit2' with a valid tokenAuth", async () => {
    const { buildSettleEnvelope } = await import("../src/settle/build-envelope.js");
    const result = buildSettleEnvelope({
      escrowAddress: ESCROW,
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: "1",
        functionName: "foo()",
        functionSignature: "0xdeadbeef",
        sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
      },
      strategy: "permit2",
      tokenAuth: {
        kind: "permit2",
        data: {
          permitted: { token: ASSET, amount: AMOUNT },
          spender: ESCROW,
          nonce: "0",
          deadline: Math.floor(Date.now() / 1000) + 300,
          signature: `0x${"aa".repeat(32)}${"bb".repeat(32)}1b` as `0x${string}`,
        },
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect((result as { ok: true; tx: { to: string; data: string } }).tx.to).toBe(ESCROW);
  });

  it("returns a TxRequest for tokenAuthStrategy 'none'", async () => {
    const { buildSettleEnvelope } = await import("../src/settle/build-envelope.js");
    const result = buildSettleEnvelope({
      escrowAddress: ESCROW,
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: "1",
        functionName: "foo()",
        functionSignature: "0xdeadbeef",
        sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
      },
      strategy: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tx.to).toBe(ESCROW);
      expect(result.tx.data.startsWith("0x")).toBe(true);
    }
  });
});

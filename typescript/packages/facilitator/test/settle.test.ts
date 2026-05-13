import { abis } from "@bosonprotocol/common";
import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { buildCreateOfferAndCommitCalldata } from "@bosonprotocol/x402-evm/actions";
import { describe, expect, it } from "vitest";
import {
  BaseError,
  InsufficientFundsError,
  RawContractError,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseSignature,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { settle } from "../src/settle/index.js";
import type { FacilitatorConfig } from "../src/types.js";

const BUYER_PK = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const buyer = privateKeyToAccount(BUYER_PK);
const RELAYER_PK = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" as const;
const relayer = privateKeyToAccount(RELAYER_PK);

const ESCROW: Address = "0xdddddddddddddddddddddddddddddddddddddddd";
const ASSET: Address = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const CHAIN_ID = 1;
const NETWORK = `eip155:${CHAIN_ID}`;
const NONCE = "1";
const SELLER: Address = "0x1111111111111111111111111111111111111111";
const SELLER_SIG: Hex = `0x${"33".repeat(65)}`;
const AMOUNT = "1000000";
const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const EXPECTED_EXCHANGE_ID = 42n;

// Mirrors verify.test.ts's fullOffer shape so the verify step inside
// settle()'s pipeline accepts the calldata as consistent with the
// advertised offer.
const fullOffer = {
  price: AMOUNT,
  sellerDeposit: "0",
  agentId: "0",
  buyerCancelPenalty: "0",
  quantityAvailable: "1",
  validFromDateInMS: "1900000000000",
  validUntilDateInMS: "1900003600000",
  voucherRedeemableFromDateInMS: "1900000000000",
  voucherRedeemableUntilDateInMS: "1900003600000",
  disputePeriodDurationInMS: "86400000",
  voucherValidDurationInMS: "0",
  resolutionPeriodDurationInMS: "604800000",
  exchangeToken: ASSET,
  disputeResolverId: "1",
  metadataUri: "ipfs://QmDeadBeef",
  metadataHash: "QmDeadBeef",
  collectionIndex: "0",
  feeLimit: "0",
  offerCreator: SELLER,
  committer: buyer.address,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    gatingType: 0,
    minTokenId: "0",
    threshold: "0",
    maxCommits: "0",
    maxTokenId: "0",
  },
  useDepositedFunds: false,
  signature: SELLER_SIG,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: "0x0000000000000000000000000000000000000000",
  },
};

async function buildValidPayload(): Promise<EscrowPaymentPayload> {
  const calldata = buildCreateOfferAndCommitCalldata({
    fullOffer: fullOffer as Parameters<typeof buildCreateOfferAndCommitCalldata>[0]["fullOffer"],
  });
  const typedData = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: BigInt(NONCE),
      from: buyer.address,
      contractAddress: ESCROW,
      functionName: calldata.functionName,
      functionSignature: calldata.functionSignature,
    },
  });
  const sig = await buyer.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const parsed = parseSignature(sig);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;
  return {
    x402Version: 1,
    scheme: "escrow",
    network: NETWORK,
    payload: {
      action: "boson-createOfferAndCommit",
      tokenAuthStrategy: "none",
      offerRef: { fullOffer, sellerSig: SELLER_SIG },
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: NONCE,
        functionName: calldata.functionName,
        functionSignature: calldata.functionSignature,
        sig: { v, r: parsed.r, s: parsed.s },
      },
    },
  };
}

function buildValidRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:42",
    maxTimeoutSeconds: 3600,
    offer: {
      fullOffer,
      sellerSig: SELLER_SIG,
      creator: SELLER,
    },
    tokenAuthStrategies: ["none"],
    actions: {
      next: [{ id: "boson-createOfferAndCommit", channels: ["server", "facilitator", "onchain"] }],
    },
  };
}

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
    waitForTransactionReceipt: async () => opts.receipt ?? buildReceipt(),
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
  // verify's signature-recovery on its own in verify.test.ts and the
  // UNSUPPORTED_TOKEN_AUTH_STRATEGY mapping in the `buildSettleEnvelope`
  // describe block below — together they cover the path without a real
  // anvil fork.

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
  it("returns UNSUPPORTED_TOKEN_AUTH_STRATEGY for non-none strategies", async () => {
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
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY" });
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

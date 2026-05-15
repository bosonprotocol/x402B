// Shared test fixtures — kept narrow so test files stay easy to read.
// FullOffer shape mirrors `core`'s own `eip712/full-offer.test.ts` so
// the round-trip behaviour is comparable.

import {
  buildCreateOfferAndCommitCalldata,
  buildCreateOfferCommitAndRedeemCalldata,
} from "@bosonprotocol/x402-evm";
import { metaTransactionTypedData, type UnsignedFullOffer } from "@bosonprotocol/x402-core/eip712";
import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { parseSignature, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { buildPaymentRequirements } from "../src/index.js";
import { signFullOffer } from "../src/index.js";

export const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
export const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const SELLER = "0x1111111111111111111111111111111111111111" as const;
export const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Deterministic test key — 32 bytes of `0x22`. Recovers to `0x9b87...` etc.; we read the address back from `privateKeyToAccount`. */
export const TEST_SELLER_PK = `0x${"22".repeat(32)}` as const;
export const TEST_BUYER_PK = `0x${"33".repeat(32)}` as const;

export const CHAIN_ID = 8453;
export const NETWORK = "eip155:8453" as const;

/** A valid `UnsignedFullOffer` — matches the protocol's struct shape. */
export const baseOffer: UnsignedFullOffer = {
  price: "1000000",
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
  exchangeToken: TOKEN,
  disputeResolverId: "1",
  metadataUri: "ipfs://QmDeadBeef",
  metadataHash: "QmDeadBeef",
  collectionIndex: "0",
  feeLimit: "0",
  offerCreator: SELLER,
  committer: ZERO,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: ZERO,
    gatingType: 0,
    minTokenId: "0",
    threshold: "0",
    maxCommits: "0",
    maxTokenId: "0",
  },
  useDepositedFunds: false,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: ZERO,
  },
};

export interface MakePaymentFixtureOpts {
  tokenAuthStrategy?: "none" | "erc3009" | "permit" | "permit2";
  amount?: string;
  maxTimeoutSeconds?: number;
  /** Override the action id in the payload — useful for negative tests. */
  action?: string;
  /** Force a deadline / validBefore offset (seconds in the future) for the token-auth data. */
  tokenAuthDeadlineOffset?: number;
}

export interface PaymentFixture {
  seller: PrivateKeyAccount;
  buyer: PrivateKeyAccount;
  requirements: EscrowPaymentRequirements;
  payload: EscrowPaymentPayload;
}

/**
 * Build a fully-signed `EscrowPaymentPayload` + matching
 * `EscrowPaymentRequirements` for `boson-createOfferAndCommit`. Seller
 * signs the FullOffer; buyer signs the meta-tx envelope over the
 * calldata produced by `@bosonprotocol/x402-evm`'s calldata builder
 * (so rule 7 byte-compares cleanly). All token-auth strategies are
 * supported via structural-only token-auth data (no token-side
 * EIP-712 signing — the pure validator only checks structure).
 */
export async function makePaymentFixture(
  opts: MakePaymentFixtureOpts = {},
): Promise<PaymentFixture> {
  const strategy = opts.tokenAuthStrategy ?? "none";
  const amount = opts.amount ?? "1000000";
  const maxTimeoutSeconds = opts.maxTimeoutSeconds ?? 3600;
  const action = opts.action ?? "boson-createOfferAndCommit";

  const seller = privateKeyToAccount(TEST_SELLER_PK);
  const buyer = privateKeyToAccount(TEST_BUYER_PK);

  const offerRef = await signFullOffer({
    fullOffer: { ...baseOffer, offerCreator: seller.address },
    signer: seller,
    escrow: ESCROW,
    chainId: CHAIN_ID,
  });

  const fullOfferWithSig = { ...offerRef.fullOffer, signature: offerRef.sellerSig };
  // Build the calldata that matches the requested `action`. Tests that
  // intentionally cross the wires (e.g. Flow A action with Flow B
  // calldata) override `payload.metaTx` directly after the fixture
  // returns.
  const buildCalldata =
    action === "boson-createOfferCommitAndRedeem"
      ? buildCreateOfferCommitAndRedeemCalldata
      : buildCreateOfferAndCommitCalldata;
  const calldata = await buildCalldata({
    fullOffer: fullOfferWithSig as Parameters<
      typeof buildCreateOfferAndCommitCalldata
    >[0]["fullOffer"],
  });

  const metaTxTd = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: 1n,
      from: buyer.address,
      contractAddress: ESCROW,
      functionName: calldata.functionName,
      functionSignature: calldata.functionSignature,
    },
  });
  const buyerSig = await buyer.signTypedData({
    domain: metaTxTd.domain,
    types: metaTxTd.types,
    primaryType: metaTxTd.primaryType,
    message: metaTxTd.message,
  });
  const parsed = parseSignature(buyerSig);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;

  const tokenAuthDeadlineOffset = opts.tokenAuthDeadlineOffset ?? maxTimeoutSeconds - 60;
  const deadline = Math.floor(Date.now() / 1000) + tokenAuthDeadlineOffset;
  const tokenAuth = buildTokenAuthFixture(strategy, amount, buyer.address, deadline);

  const requirements: EscrowPaymentRequirements = buildPaymentRequirements({
    offer: offerRef,
    asset: TOKEN,
    amount,
    tokenAuthStrategies: [strategy],
    recipientId: "did:boson:seller:12345",
    maxTimeoutSeconds,
    network: NETWORK,
    escrow: ESCROW,
    channelRegistry: {
      channels: ["server", "facilitator", "onchain", "mcp"],
      escrow: ESCROW,
      mcp: "boson://seller/12345",
    },
  });

  const payload: EscrowPaymentPayload = {
    x402Version: 2,
    scheme: "escrow",
    network: NETWORK,
    payload: {
      action,
      tokenAuthStrategy: strategy,
      offerRef: { fullOffer: offerRef.fullOffer, sellerSig: offerRef.sellerSig },
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: "1",
        functionName: calldata.functionName,
        functionSignature: calldata.functionSignature,
        sig: { v, r: parsed.r, s: parsed.s },
      },
      ...(tokenAuth !== undefined ? { tokenAuth } : {}),
    },
  };

  return { seller, buyer, requirements, payload };
}

function buildTokenAuthFixture(
  strategy: "none" | "erc3009" | "permit" | "permit2",
  amount: string,
  buyer: string,
  deadline: number,
): EscrowPaymentPayload["payload"]["tokenAuth"] {
  const zeroSig: { v: number; r: Hex; s: Hex } = {
    v: 27,
    r: `0x${"00".repeat(32)}` as Hex,
    s: `0x${"00".repeat(32)}` as Hex,
  };
  switch (strategy) {
    case "none":
      return undefined;
    case "erc3009":
      return {
        kind: "erc3009",
        data: {
          from: buyer,
          to: ESCROW,
          value: amount,
          validAfter: 0,
          validBefore: deadline,
          nonce: `0x${"11".repeat(32)}`,
          ...zeroSig,
        },
      };
    case "permit":
      return {
        kind: "permit",
        data: {
          owner: buyer,
          spender: ESCROW,
          value: amount,
          deadline,
          nonce: "0",
          ...zeroSig,
        },
      };
    case "permit2":
      return {
        kind: "permit2",
        data: {
          permitted: { token: TOKEN, amount },
          spender: ESCROW,
          nonce: "0",
          deadline,
          signature: `0x${"22".repeat(65)}` as Hex,
        },
      };
  }
}

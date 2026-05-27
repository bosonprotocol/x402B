// Reusable fixtures for the `escrow` scheme tests.
// Shapes match docs/boson-impl-01-escrow-scheme.md §2 and §3.

import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
} from "../../../src/schemes/escrow/index.js";

export const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const SELLER_ASSISTANT = "0x1111111111111111111111111111111111111111" as const;
export const BUYER = "0x2222222222222222222222222222222222222222" as const;

const HEX64_R = "0x" + "11".repeat(32);
const HEX64_S = "0x" + "22".repeat(32);
const HEX64_NONCE = "0x" + "ab".repeat(32);
const HEX_SIG = "0x" + "cd".repeat(65);

export const validRequirements: EscrowPaymentRequirements = {
  scheme: "escrow",
  network: "eip155:8453",
  asset: USDC_BASE,
  amount: "1000000",
  escrowAddress: ESCROW,
  recipientId: "did:boson:seller:12345",
  maxTimeoutSeconds: 300,
  offer: {
    fullOffer: { id: "0", price: "1000000" },
    sellerSig: "0xdeadbeef",
    creator: SELLER_ASSISTANT,
  },
  tokenAuthStrategies: ["none", "erc3009", "permit", "permit2"],
  fulfillment: {
    required: true,
    options: [
      { id: "inline", schema: null },
      {
        id: "email",
        schema: { type: "object", required: ["email"] },
        metadata: { hint: "Use a monitored delivery address" },
      },
    ],
  },
  actions: {
    next: [
      {
        id: "boson-createOfferAndCommit",
        channels: ["server", "facilitator", "onchain"],
        endpoints: { server: "https://seller.example/x402B/commit" },
      },
      {
        id: "boson-createOfferCommitAndRedeem",
        channels: ["server", "facilitator", "onchain", "mcp"],
        endpoints: {
          server: "https://seller.example/x402B/commit-and-redeem",
        },
      },
    ],
    fallback: {
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
        actionFacets: {
          "boson-createOfferAndCommit": "ExchangeCommitFacet",
          "boson-createOfferCommitAndRedeem": "OrchestrationHandlerFacet2",
        },
      },
    },
  },
};

const baseInner = {
  action: "boson-createOfferCommitAndRedeem",
  offerRef: {
    fullOffer: { id: "0", price: "1000000" },
    sellerSig: "0xdeadbeef" as const,
  },
  buyer: BUYER,
  metaTx: {
    from: BUYER,
    nonce: "0",
    functionName: "createOfferCommitAndRedeem(...)",
    functionSignature: "0xabcd1234",
    sig: { v: 27, r: HEX64_R, s: HEX64_S },
  },
} as const;

export const validPayloadNone: EscrowPaymentPayload = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: { ...baseInner, tokenAuthStrategy: "none" },
  fulfillment: { option: "inline" },
};

export const validPayloadErc3009: EscrowPaymentPayload = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: {
    ...baseInner,
    tokenAuthStrategy: "erc3009",
    tokenAuth: {
      kind: "erc3009",
      data: {
        from: BUYER,
        to: ESCROW,
        value: "1000000",
        validAfter: 0,
        validBefore: 1_900_000_000,
        nonce: HEX64_NONCE,
        v: 27,
        r: HEX64_R,
        s: HEX64_S,
      },
    },
  },
  fulfillment: { option: "email" },
};

export const validPayloadPermit: EscrowPaymentPayload = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: {
    ...baseInner,
    tokenAuthStrategy: "permit",
    tokenAuth: {
      kind: "permit",
      data: {
        owner: BUYER,
        spender: ESCROW,
        value: "1000000",
        deadline: 1_900_000_000,
        nonce: "0",
        v: 27,
        r: HEX64_R,
        s: HEX64_S,
      },
    },
  },
};

export const validPayloadPermit2: EscrowPaymentPayload = {
  x402Version: 2,
  scheme: "escrow",
  network: "eip155:8453",
  payload: {
    ...baseInner,
    tokenAuthStrategy: "permit2",
    tokenAuth: {
      kind: "permit2",
      data: {
        permitted: { token: USDC_BASE, amount: "1000000" },
        spender: ESCROW,
        nonce: "0",
        deadline: 1_900_000_000,
        signature: HEX_SIG,
      },
    },
  },
};

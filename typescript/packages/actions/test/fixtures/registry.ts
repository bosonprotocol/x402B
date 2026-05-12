// Shared `ChannelRegistry` test fixture used across the actions
// package's test files. Centralised here so `derive.test.ts` and
// `types.test.ts` reference the same canonical seller configuration.

import type { ChannelRegistry } from "../../src/index.js";

export const REGISTRY: ChannelRegistry = {
  channels: ["server", "facilitator", "onchain", "mcp", "xmtp"],
  endpoints: {
    "boson-redeem": "https://seller.example/x402B/redeem",
    "boson-cancelVoucher": "https://seller.example/x402B/cancel",
  },
  fallback: {
    xmtp: "0xSellerXMTP",
    mcp: "boson://seller/12345",
    onchainHints: {
      escrow: "0x0000000000000000000000000000000000000001",
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
        "boson-redeem": "ExchangeHandlerFacet",
        "boson-cancelVoucher": "ExchangeHandlerFacet",
        "boson-revokeVoucher": "ExchangeHandlerFacet",
        "boson-completeExchange": "ExchangeHandlerFacet",
        "boson-raiseDispute": "DisputeHandlerFacet",
        "boson-resolveDispute": "DisputeHandlerFacet",
        "boson-escalateDispute": "DisputeHandlerFacet",
        "boson-retractDispute": "DisputeHandlerFacet",
      },
    },
  },
};

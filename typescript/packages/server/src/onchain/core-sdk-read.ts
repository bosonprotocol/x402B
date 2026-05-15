// Minimal read-only adapter over `@bosonprotocol/core-sdk` used by the
// `withdraw-funds` and `available-funds` handlers.
//
// The full `CoreSDK` type pulls in a lot of surface area (every facet,
// every signing helper) — none of which the read paths need. Narrowing
// it to a structural interface keeps the server's dependency
// footprint small for consumers that just want to expose the read
// endpoints (and lets tests pass a hand-rolled stub without
// constructing a real CoreSDK).

import type { CoreSDK } from "@bosonprotocol/core-sdk";

/** Funds entity returned by `coreSdk.getFunds` — narrowed to the fields the handler reshapes. */
export interface CoreSdkFundsEntity {
  id?: string;
  accountId: string;
  availableAmount: string;
  token: {
    address: string;
    decimals: string;
    symbol: string;
    name: string;
  };
}

/** Seller entity returned by `coreSdk.getSellersByAddress` — only the id is consumed. */
export interface CoreSdkSellerEntity {
  id: string;
}

/** Buyer entity returned by `coreSdk.getBuyers` — only the id is consumed. */
export interface CoreSdkBuyerEntity {
  id: string;
}

/**
 * The subset of `CoreSDK` the read-only handlers actually use. Both the
 * real `CoreSDK` and a hand-rolled stub for tests satisfy this shape.
 */
export interface CoreSdkReadAdapter {
  getFunds(queryVars: { fundsFilter: { accountId: string } }): Promise<CoreSdkFundsEntity[]>;
  getSellersByAddress(address: string): Promise<CoreSdkSellerEntity[]>;
  getBuyers(queryVars: { buyersFilter: { wallet: string } }): Promise<CoreSdkBuyerEntity[]>;
}

/**
 * Cast a full `CoreSDK` to the narrowed adapter shape. Structural-only;
 * does not capture or wrap anything.
 */
export function asCoreSdkReadAdapter(coreSdk: CoreSDK): CoreSdkReadAdapter {
  return coreSdk as unknown as CoreSdkReadAdapter;
}

// Suite-level seed step.
//
// The local `boson-protocol-node` container already deploys the
// dispute resolver (`id: 1`) and the three test ERC-20s, so seeding
// here is narrower than it sounds — at MVP we only need to make sure
// the *seller entity* the resource-server advertises actually exists
// on chain, with the right wallet as `assistant`. Buyers don't need an
// entity to commit; the protocol creates a `Buyer` row on first
// `commitToOffer`.
//
// **Idempotency.** Every step is "create-if-not-present" — the seed
// runs as a `beforeAll` in scenario suites, so a second run on the
// same chain state must be a no-op (or fail with a clear error).
//
// **API uncertainty.** `coreSdk.createSeller(...)`'s exact argument
// shape changes between core-sdk versions; rather than guess, we
// accept a `createSeller` callback so each scenario PR can wire it to
// whatever the running core-sdk surface looks like. The default
// callback throws — the seed step is then a *check* rather than a
// *create*, so a stack with the seller pre-provisioned passes
// straight through, and a stack without one fails loudly.

import { CoreSDK } from "@bosonprotocol/core-sdk";
import { asCoreSdkReadAdapter, type CoreSdkReadAdapter } from "@bosonprotocol/x402-server";
import type { Address } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

/**
 * Read-only `Web3LibAdapter` stub. Subgraph queries don't touch
 * `web3Lib`; any access surfaces as a loud error rather than a silent
 * network call.
 */
function createReadOnlyWeb3LibStub(): never {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      throw new Error(
        `[x402-e2e/seed] read-only CoreSDK should not invoke web3Lib.${String(prop)}`,
      );
    },
  };
  return new Proxy({}, handler) as never;
}

export interface SeededSeller {
  /** Boson seller entity id (decimal string). */
  id: string;
  /** Assistant wallet — matches the `SellerActor` wallet. */
  assistant: Address;
}

export interface SuiteState {
  /** Seller entity associated with the configured `SellerActor` wallet. */
  seller: SeededSeller;
  /**
   * Default dispute resolver id (`1` on the local stack). Surfaced here
   * so scenario tests have one canonical source for it.
   */
  disputeResolverId: string;
}

export interface SeedArgs {
  /** Seller wallet address (the `SellerActor.address`). */
  sellerAddress: Address;
  /** Subgraph URL. Defaults to `LOCAL_31337_0.urls.subgraph`. */
  subgraphUrl?: string;
  /** Boson Diamond address. Defaults to `LOCAL_31337_0.contracts.protocolDiamond`. */
  protocolDiamond?: Address;
  /** Chain id. Defaults to `LOCAL_31337_0.chainId`. */
  chainId?: number;
  /**
   * Optional callback invoked when the subgraph reports no seller with
   * the given `assistant`. Receives an address and must register the
   * seller on chain (returning once the subgraph has indexed it) so
   * the seed's lookup-after-create check succeeds. Default callback
   * throws — see file header for rationale.
   */
  createSeller?: (assistantAddress: Address) => Promise<void>;
  /** Maximum poll attempts after `createSeller` returns. Default: 30 (~30s at 1s interval). */
  postCreatePollAttempts?: number;
  /** Polling interval. Default: 1000 ms. */
  postCreatePollIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function findSellerId(
  coreSdkRead: CoreSdkReadAdapter,
  assistant: Address,
): Promise<string | null> {
  const sellers = await coreSdkRead.getSellersByAddress(assistant);
  if (sellers.length === 0) return null;
  return sellers[0].id;
}

/**
 * Bootstrap the suite-level state the scenario tests assume:
 * a seller entity tied to the configured `SellerActor` wallet, and the
 * default dispute resolver id. Idempotent — running twice against the
 * same chain state is a no-op.
 */
export async function seedSuite(args: SeedArgs): Promise<SuiteState> {
  const subgraphUrl = args.subgraphUrl ?? LOCAL_31337_0.urls.subgraph;
  const protocolDiamond = args.protocolDiamond ?? LOCAL_31337_0.contracts.protocolDiamond;
  const chainId = args.chainId ?? LOCAL_31337_0.chainId;

  const sdk = new CoreSDK({
    web3Lib: createReadOnlyWeb3LibStub() as never,
    subgraphUrl,
    protocolDiamond,
    chainId,
  });
  const coreSdkRead = asCoreSdkReadAdapter(sdk);

  let sellerId = await findSellerId(coreSdkRead, args.sellerAddress);

  if (sellerId === null) {
    if (args.createSeller === undefined) {
      throw new Error(
        `[x402-e2e/seed] no seller registered for assistant ${args.sellerAddress} and no createSeller callback supplied; provide \`createSeller\` or pre-provision the seller on chain.`,
      );
    }
    await args.createSeller(args.sellerAddress);

    const attempts = args.postCreatePollAttempts ?? 30;
    const interval = args.postCreatePollIntervalMs ?? 1000;
    for (let i = 0; i < attempts; i++) {
      sellerId = await findSellerId(coreSdkRead, args.sellerAddress);
      if (sellerId !== null) break;
      await sleep(interval);
    }
    if (sellerId === null) {
      throw new Error(
        `[x402-e2e/seed] createSeller(${args.sellerAddress}) returned but the subgraph never indexed the seller after ${attempts} attempts`,
      );
    }
  }

  return {
    seller: { id: sellerId, assistant: args.sellerAddress },
    disputeResolverId: LOCAL_31337_0.defaultDisputeResolverId,
  };
}

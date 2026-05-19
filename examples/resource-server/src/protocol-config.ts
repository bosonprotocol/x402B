// Read the small slice of `ConfigHandlerFacet` state the offer builder
// needs to set tight, on-chain-grounded values for `feeLimit` and
// `disputePeriodDurationInMS`. Both functions are pure-view; the
// numbers don't change between blocks under normal operation, so
// callers fetch once at boot and thread the result through to
// `buildUnsignedOffer`.
//
// `getMaxTotalOfferFeePercentage()` returns a `uint16` cap in basis
// points (e.g. `1000` = 10 %). The offer's `feeLimit` is an absolute
// uint256 in payment-asset units; the worst-case actual fee charged
// is `floor(price * maxFeeBps / 10000)`, so setting `feeLimit` to
// exactly that lets the offer accept whatever the protocol will
// actually charge without leaving the seller exposed to a future
// fee-cap bump.
//
// `getMinDisputePeriod()` returns a `uint256` in **seconds** (the
// on-chain unit). Convert to ms before comparing against the
// caller's wall-clock-ms target — `buildUnsignedOffer` always emits
// `*InMS` fields per the core-sdk wire convention.

import type { Address, PublicClient } from "viem";

const CONFIG_HANDLER_VIEW_ABI = [
  {
    type: "function",
    name: "getMaxTotalOfferFeePercentage",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "getMinDisputePeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface ProtocolConfig {
  /** Protocol-wide cap on the sum of protocol fee + agent fee, in basis points (`10000` = 100 %). */
  maxOfferFeeBps: number;
  /** Protocol minimum for `disputePeriodDurationInMS` on a new offer, expressed in milliseconds. */
  minDisputePeriodMs: number;
}

export interface FetchProtocolConfigArgs {
  publicClient: PublicClient;
  /** `ConfigHandlerFacet` is exposed on the Diamond, so pass the protocol Diamond address. */
  escrowAddress: Address;
}

/**
 * Fetch the two `ConfigHandlerFacet` values the example offer builder
 * needs. Both are `view` calls; one block round-trip total.
 */
export async function fetchProtocolConfig(args: FetchProtocolConfigArgs): Promise<ProtocolConfig> {
  const [maxFeeBps, minDisputePeriodSeconds] = await Promise.all([
    args.publicClient.readContract({
      address: args.escrowAddress,
      abi: CONFIG_HANDLER_VIEW_ABI,
      functionName: "getMaxTotalOfferFeePercentage",
    }),
    args.publicClient.readContract({
      address: args.escrowAddress,
      abi: CONFIG_HANDLER_VIEW_ABI,
      functionName: "getMinDisputePeriod",
    }),
  ]);
  return {
    maxOfferFeeBps: Number(maxFeeBps),
    minDisputePeriodMs: Number(minDisputePeriodSeconds) * 1000,
  };
}

// Resolve an EVM address to a Boson Protocol `entityId` (seller or
// buyer) via the core-sdk subgraph helpers.
//
// `coreSdk.getSellersByAddress(addr)` matches any of the four seller
// roles (admin / assistant / clerk / treasury); `coreSdk.getBuyers({
// buyersFilter: { wallet: addr.toLowerCase() } })` covers buyer-side.
// There is no single-call helper that returns "the entityId for this
// wallet"; we call both in parallel and disambiguate.

import type { CoreSdkReadAdapter } from "../onchain/core-sdk-read.js";

export interface ResolveEntityInput {
  address: string;
  role?: "buyer" | "seller";
}

export interface ResolveEntityOk {
  ok: true;
  entityId: string;
  role: "buyer" | "seller";
}

export type ResolveEntityError =
  | { ok: false; code: "NOT_FOUND"; reason: string }
  | {
      ok: false;
      code: "AMBIGUOUS";
      reason: string;
      sellerId: string;
      buyerId: string;
    }
  | { ok: false; code: "SUBGRAPH_FAILURE"; reason: string };

export type ResolveEntityResult = ResolveEntityOk | ResolveEntityError;

export async function resolveEntityId(
  coreSdk: CoreSdkReadAdapter,
  input: ResolveEntityInput,
): Promise<ResolveEntityResult> {
  const address = input.address.toLowerCase();

  let sellers: { id: string }[] = [];
  let buyers: { id: string }[] = [];
  try {
    [sellers, buyers] = await Promise.all([
      input.role === "buyer" ? Promise.resolve([]) : coreSdk.getSellersByAddress(address),
      input.role === "seller"
        ? Promise.resolve([])
        : coreSdk.getBuyers({ buyersFilter: { wallet: address } }),
    ]);
  } catch (e) {
    return {
      ok: false,
      code: "SUBGRAPH_FAILURE",
      reason: e instanceof Error ? e.message : "subgraph lookup failed",
    };
  }

  const sellerId = sellers[0]?.id;
  const buyerId = buyers[0]?.id;

  if (input.role === "seller") {
    if (sellerId === undefined) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: `no seller entity found for address ${address}`,
      };
    }
    return { ok: true, entityId: sellerId, role: "seller" };
  }
  if (input.role === "buyer") {
    if (buyerId === undefined) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: `no buyer entity found for address ${address}`,
      };
    }
    return { ok: true, entityId: buyerId, role: "buyer" };
  }

  // role unspecified — exactly-one rule.
  if (sellerId !== undefined && buyerId !== undefined) {
    return {
      ok: false,
      code: "AMBIGUOUS",
      reason: `address ${address} resolves to both a seller (id ${sellerId}) and a buyer (id ${buyerId}); pass role to disambiguate`,
      sellerId,
      buyerId,
    };
  }
  if (sellerId !== undefined) return { ok: true, entityId: sellerId, role: "seller" };
  if (buyerId !== undefined) return { ok: true, entityId: buyerId, role: "buyer" };
  return {
    ok: false,
    code: "NOT_FOUND",
    reason: `no seller or buyer entity found for address ${address}`,
  };
}

// Resolve an EVM address to a Boson Protocol `entityId` (seller or
// buyer) via the core-sdk subgraph helpers.
//
// `coreSdk.getSellersByAddress(addr)` matches any of the four seller
// roles (admin / assistant / clerk / treasury); `coreSdk.getBuyers({
// buyersFilter: { wallet: addr.toLowerCase() } })` covers buyer-side.
// There is no single-call helper that returns "the entityId for this
// wallet"; we call both in parallel and disambiguate.
//
// Both branches can also legitimately return *multiple* entities for
// one address — one wallet can be the admin of several Boson sellers,
// for example. When that happens we refuse to guess: the caller must
// re-issue with an explicit `entityId` so the withdraw signature
// commits to a single account.

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
      /** Seller ids matching the address (one or many). Absent when no sellers matched. */
      sellerIds?: string[];
      /** Buyer ids matching the address (one or many). Absent when no buyers matched. */
      buyerIds?: string[];
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

  const sellerIds = sellers.map((s) => s.id);
  const buyerIds = buyers.map((b) => b.id);

  if (input.role === "seller") {
    if (sellerIds.length === 0) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: `no seller entity found for address ${address}`,
      };
    }
    if (sellerIds.length > 1) {
      return {
        ok: false,
        code: "AMBIGUOUS",
        reason: `address ${address} resolves to multiple seller entities (ids ${sellerIds.join(", ")}); pass entityId to disambiguate`,
        sellerIds,
      };
    }
    return { ok: true, entityId: sellerIds[0]!, role: "seller" };
  }
  if (input.role === "buyer") {
    if (buyerIds.length === 0) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: `no buyer entity found for address ${address}`,
      };
    }
    if (buyerIds.length > 1) {
      return {
        ok: false,
        code: "AMBIGUOUS",
        reason: `address ${address} resolves to multiple buyer entities (ids ${buyerIds.join(", ")}); pass entityId to disambiguate`,
        buyerIds,
      };
    }
    return { ok: true, entityId: buyerIds[0]!, role: "buyer" };
  }

  // role unspecified — exactly-one rule across both sides.
  const totalMatches = sellerIds.length + buyerIds.length;
  if (totalMatches === 0) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: `no seller or buyer entity found for address ${address}`,
    };
  }
  if (totalMatches > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS",
      reason: `address ${address} resolves to ${describeMatches(sellerIds, buyerIds)}; pass role and/or entityId to disambiguate`,
      ...(sellerIds.length > 0 ? { sellerIds } : {}),
      ...(buyerIds.length > 0 ? { buyerIds } : {}),
    };
  }
  if (sellerIds.length === 1) return { ok: true, entityId: sellerIds[0]!, role: "seller" };
  return { ok: true, entityId: buyerIds[0]!, role: "buyer" };
}

function describeMatches(sellerIds: string[], buyerIds: string[]): string {
  const parts: string[] = [];
  if (sellerIds.length > 0) {
    parts.push(
      sellerIds.length === 1
        ? `seller (id ${sellerIds[0]})`
        : `${sellerIds.length} sellers (ids ${sellerIds.join(", ")})`,
    );
  }
  if (buyerIds.length > 0) {
    parts.push(
      buyerIds.length === 1
        ? `buyer (id ${buyerIds[0]})`
        : `${buyerIds.length} buyers (ids ${buyerIds.join(", ")})`,
    );
  }
  return parts.join(" and ");
}

// Read-only handler returning a Boson entity's currently available
// funds. Backed by `coreSdk.getFunds` against the protocol subgraph.
//
// Accepts either a raw `entityId` (the protocol's own numeric id) or an
// EVM `address` (with optional `role` to disambiguate when the address
// is registered as both a seller and a buyer).

import type { Address } from "@bosonprotocol/x402-core/schemes/escrow";

import type { CoreSdkReadAdapter } from "../onchain/core-sdk-read.js";
import { handlerErr, plainHandlerOk, type PlainHandlerResult } from "./types.js";
import { resolveEntityId } from "./resolve-entity.js";

const DECIMAL_UINT_RE = /^\d+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface AvailableFundsEntry {
  tokenAddress: Address;
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  availableAmount: string;
}

export interface AvailableFundsBody {
  entityId: string;
  /** Present when the caller looked up by `address`; omitted when looked up by `entityId`. */
  role?: "buyer" | "seller";
  funds: AvailableFundsEntry[];
}

export type AvailableFundsQuery =
  | { entityId: string }
  | { address: string; role?: "buyer" | "seller" };

export interface AvailableFundsContext {
  coreSdkRead: CoreSdkReadAdapter;
}

export async function handleGetAvailableFunds(
  query: AvailableFundsQuery,
  ctx: AvailableFundsContext,
): Promise<PlainHandlerResult<AvailableFundsBody>> {
  let entityId: string;
  let role: "buyer" | "seller" | undefined;

  if ("entityId" in query) {
    if (!DECIMAL_UINT_RE.test(query.entityId)) {
      return handlerErr(
        400,
        "INVALID_ENTITY_ID",
        `entityId must be a decimal uint256 string, got "${query.entityId}"`,
      );
    }
    entityId = query.entityId;
  } else {
    if (!ADDRESS_RE.test(query.address)) {
      return handlerErr(
        400,
        "INVALID_ADDRESS",
        `address must be a 20-byte 0x-prefixed hex string, got "${query.address}"`,
      );
    }
    const resolved = await resolveEntityId(ctx.coreSdkRead, {
      address: query.address,
      ...(query.role !== undefined ? { role: query.role } : {}),
    });
    if (!resolved.ok) {
      const status =
        resolved.code === "NOT_FOUND" ? 404 : resolved.code === "AMBIGUOUS" ? 409 : 502;
      return handlerErr(status, resolved.code, resolved.reason, omitErrorMetadata(resolved));
    }
    entityId = resolved.entityId;
    role = resolved.role;
  }

  let raw;
  try {
    raw = await ctx.coreSdkRead.getFunds({ fundsFilter: { accountId: entityId } });
  } catch (e) {
    return handlerErr(
      502,
      "SUBGRAPH_FAILURE",
      e instanceof Error ? e.message : "subgraph getFunds lookup failed",
    );
  }

  const funds: AvailableFundsEntry[] = raw.map((entry) => ({
    tokenAddress: entry.token.address as Address,
    tokenSymbol: entry.token.symbol,
    tokenName: entry.token.name,
    decimals: Number(entry.token.decimals),
    availableAmount: entry.availableAmount,
  }));

  return plainHandlerOk<AvailableFundsBody>({
    entityId,
    ...(role !== undefined ? { role } : {}),
    funds,
  });
}

function omitErrorMetadata(resolved: {
  code: string;
  sellerId?: string;
  buyerId?: string;
}): Record<string, string> | undefined {
  if (resolved.code === "AMBIGUOUS" && resolved.sellerId && resolved.buyerId) {
    return { sellerId: resolved.sellerId, buyerId: resolved.buyerId };
  }
  return undefined;
}

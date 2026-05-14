// Extract the on-chain `exchangeId` from a successful commit receipt.
//
// Boson's commit path (`createOfferAndCommit` /
// `createOfferCommitAndRedeem`) emits `BuyerCommitted(uint256 offerId,
// uint256 buyerId, uint256 exchangeId, BosonTypes.Exchange exchange,
// BosonTypes.Voucher voucher, address executedBy)` — the canonical ABI
// lives in `@bosonprotocol/common`'s `IBosonExchangeHandlerABI`. We
// parse the receipt's logs against that ABI to pull the indexed
// `exchangeId`.

import { abis } from "@bosonprotocol/common";
import { parseEventLogs, type TransactionReceipt } from "viem";

import type { FacilitatorErrorCode } from "../types.js";

const EXCHANGE_HANDLER_ABI = abis.IBosonExchangeHandlerABI as readonly unknown[];

export interface ExtractExchangeIdResult {
  ok: true;
  exchangeId: string;
}

export type ExtractExchangeIdReturn =
  | ExtractExchangeIdResult
  | { ok: false; code: FacilitatorErrorCode; reason: string };

export function extractExchangeId(receipt: TransactionReceipt): ExtractExchangeIdReturn {
  const events = parseEventLogs({
    abi: EXCHANGE_HANDLER_ABI,
    eventName: "BuyerCommitted",
    logs: receipt.logs,
  });
  const first = events[0];
  if (!first) {
    return {
      ok: false,
      code: "EVENT_NOT_FOUND",
      reason: `no BuyerCommitted event in receipt ${receipt.transactionHash}`,
    };
  }
  // viem types the parsed event as `{ args: ... }`. The `args.exchangeId`
  // is a bigint per the ABI's `uint256`; serialise as a decimal string to
  // match the wire format every other Boson identifier uses.
  const args = (first as unknown as { args: { exchangeId?: bigint } }).args;
  const exchangeId = args.exchangeId;
  if (typeof exchangeId !== "bigint") {
    return {
      ok: false,
      code: "EVENT_NOT_FOUND",
      reason: "BuyerCommitted event present but exchangeId arg is missing or malformed",
    };
  }
  return { ok: true, exchangeId: exchangeId.toString() };
}

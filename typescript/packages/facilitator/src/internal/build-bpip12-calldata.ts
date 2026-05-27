// Encode the calldata for the BPIP-12 envelope
// `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`,
// including the action-aware token-transfer authorisation queue.
//
// The outer envelope ABI comes from `@bosonprotocol/common`'s
// `IBosonMetaTransactionsHandlerABI` — the canonical source kept in
// lock-step with the deployed protocol.
//
// The queue contents are still built locally because core-sdk's
// `erc20.handler.encodeTransferAuthorizationEntry` is an exhaustive
// switch over `ERC3009 | EIP2612 | Permit2 | DAIPermit` with no way to
// emit an **empty entry** (`0x`). On-chain
// `TokenTransferAuthorizationLib.loadQueue` accepts `0x` as a shortcut
// for "no auth, fall back to ERC-20 allowance" — and the commit-time
// meta-tx requires exactly that shape, with a leading run of empty
// slots consumed by the pre-buyer `transferFundsIn` calls (e.g. the
// zero-amount seller-deposit slot in `createOfferAndCommit`).
//
// Follow-up: once core-sdk supports fallback queue entries, this file
// can be retired in favour of
// `metaTx.handler.executeMetaTransactionWithTokenTransferAuthorization({ returnTxInfo: true })`.

import { abis } from "@bosonprotocol/common";
import type { BosonTokenAuth } from "@bosonprotocol/x402-core/schemes/escrow";
import { encodeAbiParameters, encodeFunctionData, type Hex } from "viem";

import { preBuyerSkipSlots } from "./queue-layout.js";

const META_TX_HANDLER_ABI = abis.IBosonMetaTransactionsHandlerABI as readonly unknown[];

/**
 * Strategy id matches `BosonTypes.TokenTransferAuthorizationStrategy`
 * (see `boson-protocol-contracts/contracts/domain/BosonTypes.sol`).
 * `None = 0` is unused by the off-chain caller — empty bytes already
 * mean "fall back" — but the values are pinned to the on-chain enum.
 */
const TRANSFER_STRATEGY_ID = {
  ERC3009: 1,
  EIP2612: 2,
  Permit2: 3,
} as const;

const FALLBACK_ENTRY: Hex = "0x";

/**
 * Encode one token-auth entry as `abi.encode(uint8 strategy, bytes data)`,
 * matching the layout the protocol's `consumeForTransfer` decodes. The
 * `data` payload is strategy-specific and mirrors the SDK's
 * `encodeTransferAuthorizationEntry` for parity.
 */
function encodeAuthEntry(tokenAuth: BosonTokenAuth): Hex {
  switch (tokenAuth.kind) {
    case "erc3009": {
      const data = encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "uint8" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          BigInt(tokenAuth.data.validAfter),
          BigInt(tokenAuth.data.validBefore),
          tokenAuth.data.nonce as Hex,
          tokenAuth.data.v,
          tokenAuth.data.r as Hex,
          tokenAuth.data.s as Hex,
        ],
      );
      return encodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes" }],
        [TRANSFER_STRATEGY_ID.ERC3009, data],
      );
    }
    case "permit": {
      const data = encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
        [
          BigInt(tokenAuth.data.deadline),
          tokenAuth.data.v,
          tokenAuth.data.r as Hex,
          tokenAuth.data.s as Hex,
        ],
      );
      return encodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes" }],
        [TRANSFER_STRATEGY_ID.EIP2612, data],
      );
    }
    case "permit2": {
      const data = encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
        [
          BigInt(tokenAuth.data.nonce),
          BigInt(tokenAuth.data.deadline),
          tokenAuth.data.signature as Hex,
        ],
      );
      return encodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes" }],
        [TRANSFER_STRATEGY_ID.Permit2, data],
      );
    }
    default: {
      // Compile-time exhaustiveness — a new BosonTokenAuth variant must
      // grow a matching case here.
      const _exhaustive: never = tokenAuth;
      throw new Error(
        `facilitator/build-bpip12-calldata: unrecognised tokenAuth.kind '${(_exhaustive as { kind: string }).kind}'`,
      );
    }
  }
}

export interface BuildBpip12QueueArgs {
  /** Action id from `payload.payload.action` (e.g. `"boson-createOfferAndCommit"`). */
  actionId: string;
  /** Buyer's wire-format token-auth entry. */
  tokenAuth: BosonTokenAuth;
}

/**
 * Build the `bytes[]` queue the protocol's
 * `TokenTransferAuthorizationLib.loadQueue` parses, with a leading run
 * of empty entries (one per pre-buyer `transferFundsIn` site) and the
 * buyer's auth at the final index.
 */
export function buildBpip12Queue(args: BuildBpip12QueueArgs): Hex[] {
  const skipSlots = preBuyerSkipSlots(args.actionId);
  const entries: Hex[] = [];
  for (let i = 0; i < skipSlots; i++) {
    entries.push(FALLBACK_ENTRY);
  }
  entries.push(encodeAuthEntry(args.tokenAuth));
  return entries;
}

export interface BuildBpip12CalldataArgs {
  /** Diamond / escrow address — the `to` of the resulting transaction. */
  escrowAddress: `0x${string}`;
  /** Buyer EOA — first argument of the BPIP-12 envelope. */
  userAddress: `0x${string}`;
  /** Inner meta-tx function name (e.g. `"createOfferAndCommit(...)"`). */
  functionName: string;
  /** Inner meta-tx function signature (ABI-encoded `data`). */
  functionSignature: Hex;
  /** Meta-tx nonce. */
  nonce: bigint;
  /** Packed 65-byte buyer signature over the meta-tx digest (`r ++ s ++ v`). */
  signature: Hex;
  /** Action id — drives the queue layout via `preBuyerSkipSlots`. */
  actionId: string;
  /** Buyer's wire-format token-auth entry. */
  tokenAuth: BosonTokenAuth;
}

/**
 * Build the full calldata for
 * `executeMetaTransactionWithTokenTransferAuthorization(...)` against
 * the Boson Diamond — queue + outer envelope in one shot. Callers feed
 * the result straight into `walletClient.sendTransaction(...)` (settle)
 * or `publicClient.call(...)` (simulate).
 */
export function buildBpip12Calldata(args: BuildBpip12CalldataArgs): {
  to: `0x${string}`;
  data: Hex;
} {
  const queue = buildBpip12Queue({ actionId: args.actionId, tokenAuth: args.tokenAuth });
  const data = encodeFunctionData({
    abi: META_TX_HANDLER_ABI,
    functionName: "executeMetaTransactionWithTokenTransferAuthorization",
    args: [
      args.userAddress,
      args.functionName,
      args.functionSignature,
      args.nonce,
      args.signature,
      queue,
    ],
  });
  return { to: args.escrowAddress, data };
}

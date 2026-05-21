// Encode the calldata for the BPIP-12 envelope
// `MetaTransactionsHandlerFacet.executeMetaTransactionWithTokenTransferAuthorization`,
// including the action-aware token-transfer authorisation queue.
//
// Why not route through `@bosonprotocol/core-sdk`'s
// `metaTx.handler.executeMetaTransactionWithTokenTransferAuthorization`?
// The SDK's `erc20.handler.encodeTransferAuthorizationQueue` only knows
// how to encode strategy-typed entries (`ERC3009` / `EIP2612` / `Permit2`).
// The deployed protocol additionally accepts an **empty entry** (`0x`) as
// a shortcut for "no auth, fall back to ERC-20 allowance" — and the
// commit-time meta-tx requires exactly that shape, with a leading empty
// slot consumed by the zero-amount seller-deposit `transferFundsIn` call.
// The SDK has no way to express that, so the facilitator builds the
// queue and outer calldata directly via viem instead.

import type { BosonTokenAuth } from "@bosonprotocol/x402-core/schemes/escrow";
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";

import { preBuyerSkipSlots } from "./queue-layout.js";

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

export const META_TX_BPIP12_ABI = parseAbi([
  "function executeMetaTransactionWithTokenTransferAuthorization(address userAddress, string functionName, bytes functionSignature, uint256 nonce, bytes signature, bytes tokenTransferAuthorization) returns (bytes)",
]);

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
 * Build the `abi.encode(bytes[] queue)` payload the protocol's
 * `TokenTransferAuthorizationLib.loadQueue` parses, with a leading run
 * of empty entries (one per pre-buyer `transferFundsIn` site) and the
 * buyer's auth at the final index.
 */
export function buildBpip12QueueBytes(args: BuildBpip12QueueArgs): Hex {
  const skipSlots = preBuyerSkipSlots(args.actionId);
  const entries: Hex[] = [];
  for (let i = 0; i < skipSlots; i++) {
    entries.push(FALLBACK_ENTRY);
  }
  entries.push(encodeAuthEntry(args.tokenAuth));
  return encodeAbiParameters([{ type: "bytes[]" }], [entries]);
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
  const queueBytes = buildBpip12QueueBytes({ actionId: args.actionId, tokenAuth: args.tokenAuth });
  const data = encodeFunctionData({
    abi: META_TX_BPIP12_ABI,
    functionName: "executeMetaTransactionWithTokenTransferAuthorization",
    args: [
      args.userAddress,
      args.functionName,
      args.functionSignature,
      args.nonce,
      args.signature,
      queueBytes,
    ],
  });
  return { to: args.escrowAddress, data };
}

// Sign Boson protocol meta-transactions for post-commit buyer actions.
//
// These are the transitions the buyer can drive once an exchange exists on
// chain: redeem the voucher, cancel/complete the exchange, or move through
// the dispute family. Each is a single-call meta-tx that the
// server/facilitator submits via
// `MetaTransactionsHandlerFacet.executeMetaTransaction`. None of them
// carry a token-auth payload (the funds are already escrowed) so the
// returned `BosonMetaTx` is the full wire-format the server consumes —
// usually as a JSON POST body, not an `X-PAYMENT` header.
//
// We return both the `BosonMetaTx` envelope (useful for on-chain or MCP
// channels) and the ABI-encoded `signedPayload` Hex consumed by the
// server/facilitator HTTP convenience routes. The encoder lives in
// `@bosonprotocol/x402-evm/codec` so client and facilitator share one
// implementation.
//
// `boson-escalateDispute` is the one exception. If the dispute resolver
// requires an escalation deposit, the resolver/server can return its own
// 402 carrying an `escrow` `PaymentRequirements` and the buyer pairs this
// meta-tx with a token-auth payload — that wrapper lives outside MVP. Here
// we only sign the meta-tx itself; the deposit flow is a later PR.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type { BosonMetaTx, Hex as WireHex } from "@bosonprotocol/x402-core/schemes/escrow";
import type { ActionId } from "@bosonprotocol/x402-core/state-machine";
import { encodeSignedPayload } from "@bosonprotocol/x402-evm/codec";
import type { Address, Hex } from "viem";

import { randomUint256 } from "./utils/crypto.js";

// Matches the subset of ethers' `BigNumberish` core-sdk actually accepts at
// runtime, without pulling `@ethersproject/bignumber` into this package's
// declared deps. Callers usually pass decimal strings (the wire format).
type BigNumberish = string | number | bigint;

/**
 * Buyer-invokable post-commit action ids — derived from `ActionId` in
 * `@bosonprotocol/x402-core/state-machine` (the single source of truth)
 * by excluding:
 *
 *  - the commit-time ids, which the buyer signs via `handle402`;
 *  - `boson-revokeVoucher`, which is seller-only;
 *  - entity-keyed actions (`boson-withdrawFunds`), which are signed via
 *    `client.signWithdrawFunds` / `client.signWithdrawAllAvailableFunds`
 *    because they take an `entityId` + token list rather than an
 *    `exchangeId`.
 */
type BuyerPostCommitActionId = Exclude<
  ActionId,
  | "boson-createOfferAndCommit"
  | "boson-createOfferCommitAndRedeem"
  | "boson-revokeVoucher"
  | "boson-withdrawFunds"
>;

/** Caller-supplied arguments for `client.signAction`. */
export type SignActionArgs = SimplePostCommitArgs | ResolveDisputeArgs;

interface BaseArgs {
  exchangeId: BigNumberish;
  /** CAIP-2 network identifier (e.g. `"eip155:8453"`). */
  network: string;
  /** Boson Diamond address (the `escrowAddress` from the prior 402). */
  escrowAddress: Address;
}

export interface SimplePostCommitArgs extends BaseArgs {
  actionId: Exclude<BuyerPostCommitActionId, "boson-resolveDispute">;
}

export interface ResolveDisputeArgs extends BaseArgs {
  actionId: "boson-resolveDispute";
  /** Buyer share of the disputed amount, in the units the protocol expects (basis points). */
  buyerPercent: BigNumberish;
  /** Counterparty (seller) signature over the proposal. Hex string or `{r, s, v}`. */
  counterpartySig: Hex | { r: Hex; s: Hex; v: number };
}

export interface SignPostCommitActionDeps {
  buildCoreSdk: (network: string, escrowAddress: Address) => { coreSdk: CoreSDK; chainId: number };
  getBuyerAddress: () => Promise<Address>;
}

/**
 * Wire-format result of `signPostCommitAction`: the signed `BosonMetaTx`
 * envelope plus its ABI-encoded `signedPayload` Hex. Pick the one that
 * matches the channel — the server/facilitator HTTP routes consume
 * `signedPayload`; direct on-chain or MCP submissions use `metaTx`.
 */
export interface SignedPostCommitAction {
  metaTx: BosonMetaTx;
  /**
   * ABI-encoded `BosonMetaTx` ready to drop into a server / facilitator
   * route's `signedPayload` field. The hex is JSON-serialisable; we type
   * it as the loose wire `Hex` (string) rather than viem's strict
   * `\`0x\${string}\`` so the codec's output matches the schemes module's
   * own `Hex` alias.
   */
  signedPayload: WireHex;
}

/**
 * Sign a post-commit action through the appropriate `CoreSDK.signMetaTx*`
 * mixin method. Returns both the wire-format `BosonMetaTx` envelope and
 * the ABI-encoded `signedPayload` Hex ready to POST to a server /
 * facilitator route.
 */
export async function signPostCommitAction(
  args: SignActionArgs,
  deps: SignPostCommitActionDeps,
): Promise<SignedPostCommitAction> {
  const nonce = randomUint256();
  const buyer = await deps.getBuyerAddress();
  const { coreSdk } = deps.buildCoreSdk(args.network, args.escrowAddress);

  const signed = await callSignMetaTx(coreSdk, args, nonce);

  const metaTx: BosonMetaTx = {
    from: buyer,
    nonce: nonce.toString(),
    functionName: signed.functionName,
    functionSignature: signed.functionSignature as Hex,
    sig: {
      v: Number(signed.v),
      r: signed.r as Hex,
      s: signed.s as Hex,
    },
  };

  return { metaTx, signedPayload: encodeSignedPayload(metaTx) };
}

interface SignedMetaTxShape {
  functionName: string;
  functionSignature: string;
  r: string;
  s: string;
  v: number;
}

async function callSignMetaTx(
  coreSdk: CoreSDK,
  args: SignActionArgs,
  nonce: bigint,
): Promise<SignedMetaTxShape> {
  const nonceStr = nonce.toString();
  const exchangeId = args.exchangeId;

  switch (args.actionId) {
    case "boson-redeem":
      return coreSdk.signMetaTxRedeemVoucher({ nonce: nonceStr, exchangeId });
    case "boson-cancelVoucher":
      return coreSdk.signMetaTxCancelVoucher({ nonce: nonceStr, exchangeId });
    case "boson-completeExchange":
      return coreSdk.signMetaTxCompleteExchange({ nonce: nonceStr, exchangeId });
    case "boson-raiseDispute":
      return coreSdk.signMetaTxRaiseDispute({ nonce: nonceStr, exchangeId });
    case "boson-retractDispute":
      return coreSdk.signMetaTxRetractDispute({ nonce: nonceStr, exchangeId });
    case "boson-escalateDispute":
      return coreSdk.signMetaTxEscalateDispute({ nonce: nonceStr, exchangeId });
    case "boson-resolveDispute":
      return coreSdk.signMetaTxResolveDispute({
        nonce: nonceStr,
        exchangeId,
        buyerPercent: args.buyerPercent,
        counterpartySig: args.counterpartySig,
      });
    default: {
      // The discriminated union makes this unreachable at the type level;
      // the `never` annotation enforces exhaustiveness at compile time, and
      // the throw guarantees a clear error if a runtime value ever slips
      // past the type checker.
      const _exhaustive: never = args;
      throw new Error(
        `x402-client: unsupported post-commit action '${(_exhaustive as { actionId: string }).actionId}'`,
      );
    }
  }
}

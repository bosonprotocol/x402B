// Sign Boson protocol meta-transactions for the entity-keyed
// `boson-withdrawFunds` action.
//
// Unlike the buyer-side post-commit signers, withdraw is keyed by the
// Boson account `entityId` (buyer or seller) rather than an exchange
// id. The on-chain primitive is
// `FundsHandlerFacet.withdrawFunds(uint256 entityId, address[] tokenList,
// uint256[] tokenAmounts)`. The meta-tx variant
// (`coreSdk.signMetaTxWithdrawFunds`) wraps that calldata in an EIP-712
// envelope ready for `MetaTransactionsHandlerFacet.executeMetaTransaction`.
//
// Scope cap for v1: callers withdraw the *whole* current balance set.
// `signWithdrawAllAvailableFunds` reads the funds entity from the
// subgraph, drops zero balances, then delegates to `signWithdrawFunds`
// for the actual EIP-712 sign. Partial / user-chosen amounts can be
// added later without a wire-format change.

import type { CoreSDK } from "@bosonprotocol/core-sdk";
import type { BosonMetaTx, Hex as WireHex } from "@bosonprotocol/x402-core/schemes/escrow";
import { encodeSignedPayload } from "@bosonprotocol/x402-evm/codec";
import type { Address, Hex } from "viem";

import { randomUint256 } from "./utils/crypto.js";

// Matches the subset of ethers' `BigNumberish` core-sdk actually accepts at
// runtime, without pulling `@ethersproject/bignumber` into this package's
// declared deps. Callers usually pass decimal strings (the wire format).
type BigNumberish = string | number | bigint;

const DECIMAL_UINT_RE = /^\d+$/;

/**
 * Coerce a caller-supplied `entityId` to its canonical wire form (a
 * non-negative integer decimal string). Rejects NaN, fractional, and
 * negative values up-front — passing them on to core-sdk would either
 * trip a downstream BigInt conversion or, worse, produce a signed
 * payload that always reverts on-chain.
 */
function normalizeEntityId(value: BigNumberish): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`entityId must be non-negative, got ${value.toString()}`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`entityId must be a non-negative integer, got ${String(value)}`);
    }
    return value.toString();
  }
  // typeof value === "string"
  const trimmed = value.trim();
  if (trimmed.length === 0 || !DECIMAL_UINT_RE.test(trimmed)) {
    throw new Error(`entityId must be a decimal non-negative integer string, got "${value}"`);
  }
  return trimmed;
}

/**
 * Resolution targets accepted by the "withdraw all" helper. Either
 * pass the raw `entityId` (numeric Boson account id) or an EVM
 * `address` with an optional `role` discriminator for the case where
 * the address maps to both a seller and a buyer entity.
 */
export type WithdrawEntitySelector =
  | { entityId: BigNumberish }
  | { address: Address; role?: "buyer" | "seller" };

/** Arguments accepted by `signWithdrawFunds` (caller-resolved entity + token list). */
export interface SignWithdrawFundsArgs {
  entityId: BigNumberish;
  /** CAIP-2 network identifier (e.g. `"eip155:8453"`). */
  network: string;
  /** Boson Diamond address (the `escrowAddress` from the prior 402). */
  escrowAddress: Address;
  /** Token addresses to withdraw — must align by index with `tokenAmounts`. */
  tokenList: readonly Address[];
  /** Amounts to withdraw — must align by index with `tokenList`. */
  tokenAmounts: readonly BigNumberish[];
}

/** Arguments accepted by `signWithdrawAllAvailableFunds` — entity + network only. */
export type SignWithdrawAllAvailableFundsArgs = WithdrawEntitySelector & {
  /** CAIP-2 network identifier (e.g. `"eip155:8453"`). */
  network: string;
  /** Boson Diamond address. */
  escrowAddress: Address;
};

/** Wire-format result identical in shape to `SignedPostCommitAction`. */
export interface SignedWithdrawFunds {
  metaTx: BosonMetaTx;
  signedPayload: WireHex;
  /** Resolved `entityId` (echoed back for caller convenience when looked up by address). */
  entityId: string;
  /** Tokens included in the signature, in calldata order. */
  tokenList: readonly Address[];
  /** Amounts included in the signature, in calldata order. */
  tokenAmounts: readonly string[];
}

export interface SignWithdrawDeps {
  buildCoreSdk: (network: string, escrowAddress: Address) => { coreSdk: CoreSDK; chainId: number };
  /** Returns the address that will sign the meta-tx — must match the configured signer. */
  getSignerAddress: () => Promise<Address>;
}

interface SignedMetaTxShape {
  functionName: string;
  functionSignature: string;
  r: string;
  s: string;
  v: number;
}

/** Subset of `CoreSDK` used here — kept narrow so tests can stub easily. */
interface WithdrawCoreSdkLike {
  signMetaTxWithdrawFunds(args: {
    nonce: string;
    entityId: BigNumberish;
    tokenList: string[];
    tokenAmounts: BigNumberish[];
  }): Promise<SignedMetaTxShape>;
  getFunds(queryVars: { fundsFilter: { accountId: string } }): Promise<
    Array<{
      accountId: string;
      availableAmount: string;
      token: { address: string };
    }>
  >;
  getSellersByAddress(address: string): Promise<Array<{ id: string }>>;
  getBuyers(queryVars: { buyersFilter: { wallet: string } }): Promise<Array<{ id: string }>>;
}

/**
 * Sign a `withdrawFunds(entityId, tokenList, tokenAmounts)` meta-tx
 * against the configured Diamond domain. The caller supplies the
 * exact token + amount snapshot to commit to.
 */
export async function signWithdrawFunds(
  args: SignWithdrawFundsArgs,
  deps: SignWithdrawDeps,
): Promise<SignedWithdrawFunds> {
  const normalised: SignWithdrawFundsArgs = {
    ...args,
    entityId: normalizeEntityId(args.entityId),
  };
  const { coreSdk } = deps.buildCoreSdk(normalised.network, normalised.escrowAddress);
  const from = await deps.getSignerAddress();
  return signWithdrawFundsInternal(normalised, coreSdk as unknown as WithdrawCoreSdkLike, from);
}

/**
 * "Withdraw all" sugar. Resolves the entity (by id or by address),
 * reads the funds entity from the subgraph, drops zero balances, and
 * signs `withdrawFunds(entityId, allTokens, allAmounts)`. Throws when
 * the entity has no available funds.
 */
export async function signWithdrawAllAvailableFunds(
  args: SignWithdrawAllAvailableFundsArgs,
  deps: SignWithdrawDeps,
): Promise<SignedWithdrawFunds> {
  const { coreSdk } = deps.buildCoreSdk(args.network, args.escrowAddress);
  const sdk = coreSdk as unknown as WithdrawCoreSdkLike;
  const from = await deps.getSignerAddress();
  const entityId = await resolveEntityIdClientSide(sdk, args);
  const funds = await sdk.getFunds({ fundsFilter: { accountId: entityId } });
  const nonZero = funds.filter((f) => f.availableAmount !== "0" && BigInt(f.availableAmount) > 0n);
  if (nonZero.length === 0) {
    throw new Error(
      `signWithdrawAllAvailableFunds: entity ${entityId} has no available funds to withdraw`,
    );
  }
  return signWithdrawFundsInternal(
    {
      entityId,
      network: args.network,
      escrowAddress: args.escrowAddress,
      tokenList: nonZero.map((f) => f.token.address as Address),
      tokenAmounts: nonZero.map((f) => f.availableAmount),
    },
    sdk,
    from,
  );
}

async function signWithdrawFundsInternal(
  args: SignWithdrawFundsArgs,
  coreSdk: WithdrawCoreSdkLike,
  from: Address,
): Promise<SignedWithdrawFunds> {
  if (args.tokenList.length !== args.tokenAmounts.length) {
    throw new Error(
      `signWithdrawFunds: tokenList (${args.tokenList.length}) and tokenAmounts (${args.tokenAmounts.length}) must be the same length`,
    );
  }
  const nonce = randomUint256();
  const nonceStr = nonce.toString();
  const signed = await coreSdk.signMetaTxWithdrawFunds({
    nonce: nonceStr,
    entityId: args.entityId,
    tokenList: args.tokenList.map((t) => t),
    tokenAmounts: args.tokenAmounts.map((a) => a),
  });

  const metaTx: BosonMetaTx = {
    from,
    nonce: nonceStr,
    functionName: signed.functionName,
    functionSignature: signed.functionSignature as Hex,
    sig: {
      v: Number(signed.v),
      r: signed.r as Hex,
      s: signed.s as Hex,
    },
  };

  return {
    metaTx,
    signedPayload: encodeSignedPayload(metaTx),
    entityId: normalizeEntityId(args.entityId),
    tokenList: args.tokenList,
    tokenAmounts: args.tokenAmounts.map((a) => String(a)),
  };
}

async function resolveEntityIdClientSide(
  coreSdk: WithdrawCoreSdkLike,
  selector: WithdrawEntitySelector,
): Promise<string> {
  if ("entityId" in selector) return normalizeEntityId(selector.entityId);
  const address = selector.address.toLowerCase();
  const role = selector.role;
  const [sellers, buyers] = await Promise.all([
    role === "buyer"
      ? Promise.resolve<Array<{ id: string }>>([])
      : coreSdk.getSellersByAddress(address),
    role === "seller"
      ? Promise.resolve<Array<{ id: string }>>([])
      : coreSdk.getBuyers({ buyersFilter: { wallet: address } }),
  ]);
  const sellerIds = sellers.map((s) => s.id);
  const buyerIds = buyers.map((b) => b.id);

  if (role === "seller") {
    if (sellerIds.length === 0) {
      throw new Error(
        `signWithdrawAllAvailableFunds: no seller entity found for address ${address}`,
      );
    }
    if (sellerIds.length > 1) {
      throw new Error(
        `signWithdrawAllAvailableFunds: address ${address} resolves to multiple seller entities (ids ${sellerIds.join(", ")}); pass entityId to disambiguate`,
      );
    }
    return sellerIds[0]!;
  }
  if (role === "buyer") {
    if (buyerIds.length === 0) {
      throw new Error(
        `signWithdrawAllAvailableFunds: no buyer entity found for address ${address}`,
      );
    }
    if (buyerIds.length > 1) {
      throw new Error(
        `signWithdrawAllAvailableFunds: address ${address} resolves to multiple buyer entities (ids ${buyerIds.join(", ")}); pass entityId to disambiguate`,
      );
    }
    return buyerIds[0]!;
  }

  // role unspecified — exactly-one rule across both sides. Refuse to
  // guess when the address resolves to multiple sellers, multiple
  // buyers, or any combination of the two: the signed payload commits
  // to a single entityId, so silently picking `[0]` would be a bug
  // farm waiting to bite.
  const totalMatches = sellerIds.length + buyerIds.length;
  if (totalMatches === 0) {
    throw new Error(
      `signWithdrawAllAvailableFunds: no seller or buyer entity found for address ${address}`,
    );
  }
  if (totalMatches > 1) {
    throw new Error(
      `signWithdrawAllAvailableFunds: address ${address} resolves to ${describeClientMatches(sellerIds, buyerIds)}; pass role and/or entityId to disambiguate`,
    );
  }
  if (sellerIds.length === 1) return sellerIds[0]!;
  return buyerIds[0]!;
}

function describeClientMatches(sellerIds: string[], buyerIds: string[]): string {
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

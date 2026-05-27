// Buyer-side ERC-20 prep for the scenario suite.
//
// Two flavours, picked by the scenario based on its `tokenAuthStrategy`:
//
//   - `ensureBuyerHasBalance` — mint payment tokens to the buyer if
//     the balance falls short. ERC-3009, Permit, and Permit2 carry
//     their own authorisation in the X-PAYMENT payload, so no
//     allowance is needed; balance alone gates the settle.
//   - `ensureBuyerCanPay` — calls `ensureBuyerHasBalance`, then ensures
//     a spender has a generous ERC-20 allowance. Required for the
//     `none` strategy (settle calls `transferFrom` against the escrow
//     and reverts on insufficient allowance) and for `permit2` (the
//     canonical Permit2 contract must hold a standing allowance to pull
//     from the buyer).
//
// The local Boson stack's test ERC-20 mocks (`Foreign20`,
// `MockERC3009Token`, `MockERC2612Token`) all expose a public
// `mint(to, amount)`; both helpers re-use the same minimal ABI.

import {
  parseEther,
  type Address,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { buildWalletClient } from "../../src/harness/clients.js";

const ERC20_TEST_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface EnsureBuyerHasBalanceArgs {
  /** Buyer's viem `WalletClient` (must hold native ETH for gas). */
  walletClient: WalletClient;
  /** Read-side `PublicClient`. */
  publicClient: PublicClient;
  /** Payment-asset address. */
  assetAddress: Address;
  /** Amount the scenario will commit (atomic units). */
  amount: bigint;
  /** Buyer's wallet address. */
  buyerAddress: Address;
}

export interface BuyerSetupArgs extends EnsureBuyerHasBalanceArgs {
  /**
   * The `spender` the buyer grants an ERC-20 allowance to. The escrow
   * for the `none` strategy; the canonical Permit2 contract for the
   * `permit2` strategy.
   */
  spenderAddress: Address;
}

/**
 * Mint payment tokens to the buyer until their balance covers `amount`.
 * Used by token-auth strategies (ERC-3009 / Permit / Permit2) that
 * carry their own transfer authorisation in the X-PAYMENT payload —
 * the escrow doesn't need a standing allowance, only a balance to
 * pull from.
 */
export async function ensureBuyerHasBalance(args: EnsureBuyerHasBalanceArgs): Promise<void> {
  // `WalletClient` doesn't require `account` / `chain` at the type
  // level, so unguarded non-null assertions would crash with an opaque
  // viem error if a caller passed a bare client. Surface a clear
  // harness-side message instead.
  const walletAccount = args.walletClient.account;
  const walletChain = args.walletClient.chain;
  if (walletAccount === undefined || walletChain === undefined) {
    throw new Error(
      "[x402-e2e/_buyer-setup] ensureBuyerHasBalance requires a WalletClient with both `account` and `chain` set " +
        "(use `buildWalletClient(account)`)",
    );
  }

  const balance = (await args.publicClient.readContract({
    address: args.assetAddress,
    abi: ERC20_TEST_ABI,
    functionName: "balanceOf",
    args: [args.buyerAddress],
  })) as bigint;

  if (balance < args.amount) {
    const mintHash = await args.walletClient.writeContract({
      address: args.assetAddress,
      abi: ERC20_TEST_ABI,
      functionName: "mint",
      args: [args.buyerAddress, args.amount - balance],
      account: walletAccount,
      chain: walletChain,
    });
    await args.publicClient.waitForTransactionReceipt({ hash: mintHash });
  }
}

/**
 * Ensure the buyer has at least `amount` balance + allowance against
 * `spenderAddress`. Used by the `none` token-auth strategy (spender =
 * escrow, where settle calls `transferFrom` and reverts on insufficient
 * allowance) and by `permit2` (spender = the canonical Permit2 contract,
 * which needs a standing allowance to pull from the buyer). Both the
 * mint and the approve are no-ops when re-run with sufficient balance /
 * allowance.
 */
export async function ensureBuyerCanPay(args: BuyerSetupArgs): Promise<void> {
  await ensureBuyerHasBalance(args);
  // ensureBuyerHasBalance has already validated `account` / `chain`;
  // re-extract them as locals for the type-narrowed writeContract call
  // below without re-running the guard.
  const walletAccount = args.walletClient.account;
  const walletChain = args.walletClient.chain;
  if (walletAccount === undefined || walletChain === undefined) {
    // Unreachable — ensureBuyerHasBalance would have thrown above.
    return;
  }

  const allowance = (await args.publicClient.readContract({
    address: args.assetAddress,
    abi: ERC20_TEST_ABI,
    functionName: "allowance",
    args: [args.buyerAddress, args.spenderAddress],
  })) as bigint;

  if (allowance < args.amount) {
    const approveHash = await args.walletClient.writeContract({
      address: args.assetAddress,
      abi: ERC20_TEST_ABI,
      functionName: "approve",
      // Approve a generous cap so subsequent scenarios on the same
      // chain state don't need to re-approve; refunds untouched.
      args: [args.spenderAddress, args.amount * 1000n],
      account: walletAccount,
      chain: walletChain,
    });
    await args.publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}

export interface CreateFundedBuyerArgs {
  /** WalletClient built from one of `SEED_WALLETS` (see `_seed-wallets.ts`). */
  funder: WalletClient;
  /** Read-side client used to await the funding tx receipt. */
  publicClient: PublicClient;
  /** Native ETH to send to the new EOA, as a decimal string. Defaults to `"0.5"`. */
  fundEth?: string;
}

/**
 * Generate a fresh viem `LocalAccount`, fund it from `funder` with
 * native ETH for gas, and return the account. Used by chain-touching
 * scenario describes so each describe transacts from its own EOA —
 * Vitest runs test files in parallel, and a shared buyer EOA races
 * the chain nonce across parallel files.
 *
 * The mock `Foreign20` ERC-20 the local stack ships has a public
 * `mint(to, amount)`, so the returned account self-funds payment
 * tokens via `ensureBuyerCanPay`; the seed wallet only needs to
 * cover gas.
 */
export interface RotateBuyerArgs extends CreateFundedBuyerArgs {
  /** Payment-asset address (typically `LOCAL_31337_0.contracts.testErc20`). */
  assetAddress: Address;
  /** The `spender` the rotated buyer grants an ERC-20 allowance to. */
  spenderAddress: Address;
  /** Amount the rotated buyer must be able to pay (atomic units). */
  amount: bigint;
}

/**
 * Generate a fresh buyer EOA, fund it with native ETH from `funder`,
 * and ensure it has at least `amount` of the payment asset both
 * minted and approved against `spenderAddress`. Used by F4 (buyer
 * key rotation) where the test needs a SECOND buyer key — fully
 * funded and approved — to attempt a redeem against an exchange
 * committed by the FIRST buyer key.
 *
 * Sequential: funds gas first, then mint + approve through the new
 * EOA's wallet. The mint + approve calls go through `ensureBuyerCanPay`
 * which we delegate to so the recipe stays in one place.
 */
export async function rotateBuyer(args: RotateBuyerArgs): Promise<LocalAccount> {
  const account = await createFundedBuyer(args);
  await ensureBuyerCanPay({
    walletClient: buildWalletClient(account),
    publicClient: args.publicClient,
    buyerAddress: account.address,
    assetAddress: args.assetAddress,
    spenderAddress: args.spenderAddress,
    amount: args.amount,
  });
  return account;
}

export async function createFundedBuyer(args: CreateFundedBuyerArgs): Promise<LocalAccount> {
  // `WalletClient` doesn't require `account` / `chain` at the type
  // level, so unguarded non-null assertions would crash with an opaque
  // viem error if a caller passed a bare client. Surface a clear
  // harness-side message instead.
  const funderAccount = args.funder.account;
  const funderChain = args.funder.chain;
  if (funderAccount === undefined || funderChain === undefined) {
    throw new Error(
      "[x402-e2e/_buyer-setup] createFundedBuyer requires a WalletClient with both `account` and `chain` set " +
        "(use `buildWalletClient(SEED_WALLETS.<slot>.account)`)",
    );
  }
  const account = privateKeyToAccount(generatePrivateKey());
  const hash = await args.funder.sendTransaction({
    account: funderAccount,
    chain: funderChain,
    to: account.address,
    value: parseEther(args.fundEth ?? "0.5"),
  });
  await args.publicClient.waitForTransactionReceipt({ hash });
  return account;
}

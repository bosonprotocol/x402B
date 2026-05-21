// Buyer-side ERC-20 prep for the `none` token-auth strategy.
//
// With `tokenAuthStrategy: "none"`, the buyer must have already
// approved the escrow for at least `amount` of the payment asset
// before committing — settle just calls `transferFrom` and reverts on
// insufficient allowance. The other three strategies bundle their own
// authorisation in the X-PAYMENT payload and don't need this.
//
// The local Boson stack ships the `Foreign20` test ERC-20 with a
// public `mint(to, amount)`, so we mint the buyer enough to cover the
// scenario amount before approving. Both calls are no-ops when
// re-run with already-sufficient balance / allowance.

import {
  parseEther,
  type Address,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

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

export interface BuyerSetupArgs {
  /** Buyer's viem `WalletClient` (must hold native ETH for gas). */
  walletClient: WalletClient;
  /** Read-side `PublicClient`. */
  publicClient: PublicClient;
  /** Payment-asset address (typically `LOCAL_31337_0.contracts.testErc20`). */
  assetAddress: Address;
  /** Escrow address — the `spender` the buyer approves. */
  escrowAddress: Address;
  /** Amount the scenario will commit (decimal string of atomic units). */
  amount: bigint;
  /** Buyer's wallet address. */
  buyerAddress: Address;
}

/**
 * Ensure the buyer has at least `amount` balance + allowance against
 * the escrow. Mints the deficit + sends an `approve` only when
 * necessary so re-runs of the same scenario don't burn gas pointlessly.
 */
export async function ensureBuyerCanPay(args: BuyerSetupArgs): Promise<void> {
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
      account: args.walletClient.account!,
      chain: args.walletClient.chain!,
    });
    await args.publicClient.waitForTransactionReceipt({ hash: mintHash });
  }

  const allowance = (await args.publicClient.readContract({
    address: args.assetAddress,
    abi: ERC20_TEST_ABI,
    functionName: "allowance",
    args: [args.buyerAddress, args.escrowAddress],
  })) as bigint;

  if (allowance < args.amount) {
    const approveHash = await args.walletClient.writeContract({
      address: args.assetAddress,
      abi: ERC20_TEST_ABI,
      functionName: "approve",
      // Approve a generous cap so subsequent scenarios on the same
      // chain state don't need to re-approve; refunds untouched.
      args: [args.escrowAddress, args.amount * 1000n],
      account: args.walletClient.account!,
      chain: args.walletClient.chain!,
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

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

import type { Address, PublicClient, WalletClient } from "viem";

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

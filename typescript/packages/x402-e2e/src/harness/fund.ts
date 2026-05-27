// Shared ERC-20 funding primitives for the local Boson stack.
//
// The local stack ships mock ERC-20s (`Foreign20`, `MockERC3009Token`,
// `MockERC2612Token`) that all expose a public `mint(to, amount)`, so
// any funded signer can top up an arbitrary wallet for tests/demos.
// This module centralises the ABI + the idempotent top-up so both the
// scenario buyer-setup (`test/scenarios/_buyer-setup.ts`) and the
// dockerised resource-server entrypoint (`src/bin/resource-server.ts`)
// reuse one recipe.

import type { Address, PublicClient, WalletClient } from "viem";

export const ERC20_TEST_ABI = [
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

export interface EnsureTokenBalanceArgs {
  /** Signing client used to mint. Any funded account works — `mint` is public. */
  walletClient: WalletClient;
  /** Read-side client used to check balance and await the mint receipt. */
  publicClient: PublicClient;
  /** Mock ERC-20 to mint. */
  tokenAddress: Address;
  /** Wallet whose balance should reach `targetBalance`. */
  owner: Address;
  /** Atomic-unit balance the owner should hold after this call. */
  targetBalance: bigint;
}

/**
 * Ensure `owner` holds at least `targetBalance` of `tokenAddress`,
 * minting the deficit via the mock token's public `mint(to, amount)`.
 * Idempotent — a no-op once the wallet already holds the target.
 */
export async function ensureTokenBalance(args: EnsureTokenBalanceArgs): Promise<void> {
  const balance = (await args.publicClient.readContract({
    address: args.tokenAddress,
    abi: ERC20_TEST_ABI,
    functionName: "balanceOf",
    args: [args.owner],
  })) as bigint;

  if (balance >= args.targetBalance) return;

  // `WalletClient` doesn't require `account` / `chain` at the type level,
  // so unguarded non-null assertions would crash with an opaque viem
  // error if a caller passed a bare client. Surface a clear harness-side
  // message instead.
  const walletAccount = args.walletClient.account;
  const walletChain = args.walletClient.chain;
  if (walletAccount === undefined || walletChain === undefined) {
    throw new Error(
      "[x402-e2e/fund] ensureTokenBalance requires a WalletClient with both `account` and `chain` set " +
        "(use `buildWalletClient(account)`)",
    );
  }

  const mintHash = await args.walletClient.writeContract({
    address: args.tokenAddress,
    abi: ERC20_TEST_ABI,
    functionName: "mint",
    args: [args.owner, args.targetBalance - balance],
    account: walletAccount,
    chain: walletChain,
  });
  await args.publicClient.waitForTransactionReceipt({ hash: mintHash });
}

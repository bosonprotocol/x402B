// Helper for the `tokenAuthStrategy: "none"` flow (per
// docs/boson-impl-01-escrow-scheme.md §4.3): the buyer must pre-approve
// the Boson escrow contract to spend `amount` of `token` via the standard
// ERC-20 `approve(spender, amount)` call.
//
// No EIP-712 typed-data is signed for this strategy; the buyer instead
// sends a regular ERC-20 transaction. This module just builds the calldata
// so callers can hand it to a wallet client.

import { encodeFunctionData, type Address, type Hex } from "viem";

const ERC20_APPROVE_ABI = [
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
] as const;

export interface Erc20ApprovalArgs {
  token: Address;
  spender: Address;
  amount: bigint;
}

/**
 * Build calldata for an ERC-20 `approve(spender, amount)` call. Use with
 * `walletClient.sendTransaction({ to: token, data })` or any equivalent
 * signer to grant `spender` (the Boson escrow contract) the right to
 * pull `amount` of `token`.
 */
export function createErc20ApprovalTx({ token, spender, amount }: Erc20ApprovalArgs): {
  to: Address;
  data: Hex;
} {
  return {
    to: token,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}

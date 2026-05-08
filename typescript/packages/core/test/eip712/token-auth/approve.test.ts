import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

import { createErc20ApprovalTx } from "../../../src/eip712/token-auth/index.js";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;

describe("createErc20ApprovalTx (none strategy)", () => {
  it("targets the token contract", () => {
    const tx = createErc20ApprovalTx({ token: TOKEN, spender: ESCROW, amount: 1_000_000n });
    expect(tx.to).toBe(TOKEN);
    expect(tx.data).toMatch(/^0x[0-9a-f]+$/);
  });

  it("encodes approve(spender, amount) with the right selector + args", () => {
    const tx = createErc20ApprovalTx({ token: TOKEN, spender: ESCROW, amount: 1_000_000n });
    const decoded = decodeFunctionData({
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      data: tx.data,
    });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args[0].toLowerCase()).toBe(ESCROW.toLowerCase());
    expect(decoded.args[1]).toBe(1_000_000n);
  });
});

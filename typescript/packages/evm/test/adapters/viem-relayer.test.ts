import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  RawContractError,
  type PublicClient,
  type WalletClient,
} from "viem";

import {
  classifyViemSendError,
  RelayerSubmitError,
  walletClientToWeb3LibAdapter,
} from "../../src/adapters/viem-relayer.js";

describe("classifyViemSendError", () => {
  it("maps a direct InsufficientFundsError to INSUFFICIENT_FUNDS_FOR_GAS", () => {
    const err = classifyViemSendError(new InsufficientFundsError());
    expect(err).toBeInstanceOf(RelayerSubmitError);
    expect(err.code).toBe("INSUFFICIENT_FUNDS_FOR_GAS");
  });

  it("maps a BaseError wrapping InsufficientFundsError to INSUFFICIENT_FUNDS_FOR_GAS", () => {
    const wrapped = new BaseError("wrapped", { cause: new InsufficientFundsError() });
    const err = classifyViemSendError(wrapped);
    expect(err.code).toBe("INSUFFICIENT_FUNDS_FOR_GAS");
  });

  it("maps an ExecutionRevertedError to ONCHAIN_REVERT", () => {
    const err = classifyViemSendError(new ExecutionRevertedError({ message: "reverted" }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("maps a BaseError wrapping ContractFunctionRevertedError to ONCHAIN_REVERT", () => {
    const inner = new ContractFunctionRevertedError({
      abi: [],
      functionName: "foo",
    });
    const err = classifyViemSendError(new BaseError("wrapped", { cause: inner }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("maps a BaseError wrapping RawContractError to ONCHAIN_REVERT", () => {
    const inner = new RawContractError({ message: "execution reverted: foo" });
    const err = classifyViemSendError(new BaseError("wrapped", { cause: inner }));
    expect(err.code).toBe("ONCHAIN_REVERT");
  });

  it("falls back to INTERNAL_ERROR for arbitrary errors", () => {
    const err = classifyViemSendError(new Error("RPC unreachable"));
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toContain("RPC unreachable");
  });
});

describe("walletClientToWeb3LibAdapter chainId validation", () => {
  const RELAYER = "0x1111111111111111111111111111111111111111" as const;

  function clientWithChain(chainId: number | undefined): PublicClient & WalletClient {
    return {
      chain: chainId === undefined ? undefined : { id: chainId },
      account: { address: RELAYER, type: "json-rpc" as const },
    } as unknown as PublicClient & WalletClient;
  }

  it("throws when walletClient.chain.id mismatches the adapter chainId", () => {
    expect(() =>
      walletClientToWeb3LibAdapter({
        walletClient: clientWithChain(137),
        publicClient: clientWithChain(1),
        chainId: 1,
      }),
    ).toThrow(/walletClient\.chain\.id \(137\) does not match adapter chainId \(1\)/);
  });

  it("throws when publicClient.chain.id mismatches the adapter chainId", () => {
    expect(() =>
      walletClientToWeb3LibAdapter({
        walletClient: clientWithChain(1),
        publicClient: clientWithChain(137),
        chainId: 1,
      }),
    ).toThrow(/publicClient\.chain\.id \(137\) does not match adapter chainId \(1\)/);
  });

  it("accepts matching chain ids on both clients", () => {
    expect(() =>
      walletClientToWeb3LibAdapter({
        walletClient: clientWithChain(1),
        publicClient: clientWithChain(1),
        chainId: 1,
      }),
    ).not.toThrow();
  });

  it("accepts a chain-less walletClient (chain only attached when configured explicitly)", () => {
    expect(() =>
      walletClientToWeb3LibAdapter({
        walletClient: clientWithChain(undefined),
        publicClient: clientWithChain(1),
        chainId: 1,
      }),
    ).not.toThrow();
  });
});

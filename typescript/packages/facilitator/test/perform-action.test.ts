import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import { ACTION_POST_STATE, type ActionId } from "@bosonprotocol/x402-core/state-machine";
import { describe, expect, it } from "vitest";
import {
  BaseError,
  RawContractError,
  encodeFunctionData,
  parseAbi,
  parseSignature,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeSignedPayload } from "@bosonprotocol/x402-evm/codec";
import { performAction } from "../src/perform-action/index.js";
import type { FacilitatorConfig } from "../src/types.js";

const BUYER_PK = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const buyer = privateKeyToAccount(BUYER_PK);
const SELLER_PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const seller = privateKeyToAccount(SELLER_PK);
const RELAYER_PK = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" as const;
const relayer = privateKeyToAccount(RELAYER_PK);

const ESCROW: Address = "0xdddddddddddddddddddddddddddddddddddddddd";
const CHAIN_ID = 1;
const NETWORK = `eip155:${CHAIN_ID}`;
const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const EXCHANGE_ID = "42";

const POST_COMMIT_ABI = parseAbi([
  "function redeemVoucher(uint256 exchangeId)",
  "function cancelVoucher(uint256 exchangeId)",
  "function revokeVoucher(uint256 exchangeId)",
  "function completeExchange(uint256 exchangeId)",
  "function raiseDispute(uint256 exchangeId)",
  "function resolveDispute(uint256 exchangeId, uint256 buyerPercent, bytes counterpartySig)",
  "function escalateDispute(uint256 exchangeId)",
  "function retractDispute(uint256 exchangeId)",
  "function withdrawFunds(uint256 entityId, address[] tokenList, uint256[] tokenAmounts)",
]);

const ENTITY_ID = "99";
const TOKEN_LIST: Address[] = [
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0xffffffffffffffffffffffffffffffffffffffff",
];
const TOKEN_AMOUNTS = [123n, 456n] as const;

function buildWithdrawCalldata(entityId = ENTITY_ID): Hex {
  return encodeFunctionData({
    abi: POST_COMMIT_ABI,
    functionName: "withdrawFunds",
    args: [BigInt(entityId), TOKEN_LIST, [...TOKEN_AMOUNTS]],
  });
}

function buildPostCommitCalldata(functionName: string, exchangeId = EXCHANGE_ID): Hex {
  switch (functionName) {
    case "redeemVoucher(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "redeemVoucher",
        args: [BigInt(exchangeId)],
      });
    case "cancelVoucher(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "cancelVoucher",
        args: [BigInt(exchangeId)],
      });
    case "revokeVoucher(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "revokeVoucher",
        args: [BigInt(exchangeId)],
      });
    case "completeExchange(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "completeExchange",
        args: [BigInt(exchangeId)],
      });
    case "raiseDispute(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "raiseDispute",
        args: [BigInt(exchangeId)],
      });
    case "resolveDispute(uint256,uint256,bytes)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "resolveDispute",
        args: [BigInt(exchangeId), 5000n, "0x"],
      });
    case "escalateDispute(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "escalateDispute",
        args: [BigInt(exchangeId)],
      });
    case "retractDispute(uint256)":
      return encodeFunctionData({
        abi: POST_COMMIT_ABI,
        functionName: "retractDispute",
        args: [BigInt(exchangeId)],
      });
    default:
      throw new Error(`unsupported test functionName ${functionName}`);
  }
}

/** Sign a BosonMetaTx for the given action against the Diamond domain. */
async function buildSignedPayload(
  opts: {
    signer?: ReturnType<typeof privateKeyToAccount>;
    functionName?: string;
    functionSignature?: Hex;
    exchangeId?: string;
    nonce?: string;
  } = {},
): Promise<Hex> {
  const signer = opts.signer ?? buyer;
  const functionName = opts.functionName ?? "redeemVoucher(uint256)";
  const functionSignature: Hex =
    opts.functionSignature ?? buildPostCommitCalldata(functionName, opts.exchangeId);
  const nonce = opts.nonce ?? "7";
  const typedData = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: BigInt(nonce),
      from: signer.address,
      contractAddress: ESCROW,
      functionName,
      functionSignature,
    },
  });
  const sig = await signer.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const parsed = parseSignature(sig);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;
  return encodeSignedPayload({
    from: signer.address,
    nonce,
    functionName,
    functionSignature,
    sig: { v, r: parsed.r, s: parsed.s },
  });
}

function buildPublicClient(
  opts: {
    callBehavior?: "pass" | "revert";
    receiptStatus?: "success" | "reverted";
  } = {},
): PublicClient {
  return {
    call: async () => {
      if (opts.callBehavior === "revert") {
        // Match viem's revert shape: a BaseError whose cause chain
        // contains a RawContractError. simulate.ts walks this chain to
        // classify SIMULATION_REVERT vs INTERNAL_ERROR.
        const cause = new RawContractError({ message: "execution reverted: simulated revert" });
        throw new BaseError("Execution reverted", { cause });
      }
      return { data: "0x" };
    },
    waitForTransactionReceipt: async () =>
      ({
        transactionHash: TX_HASH,
        status: opts.receiptStatus ?? "success",
        logs: [],
      }) as unknown as TransactionReceipt,
  } as unknown as PublicClient;
}

function buildWalletClient(opts: { sendBehavior?: "pass" | "fail" } = {}): WalletClient {
  return {
    account: { address: relayer.address, type: "json-rpc" },
    chain: {
      id: CHAIN_ID,
      name: "test",
      nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
      rpcUrls: { default: { http: [] } },
    },
    sendTransaction: async () => {
      if (opts.sendBehavior === "fail") throw new Error("RPC unreachable");
      return TX_HASH;
    },
  } as unknown as WalletClient;
}

function buildConfig(
  opts: {
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    escrows?: Record<string, Address>;
  } = {},
): FacilitatorConfig {
  return {
    url: "https://facilitator.example",
    supportedNetworks: [NETWORK],
    escrows: opts.escrows ?? { [NETWORK]: ESCROW },
    walletClient: opts.walletClient ?? buildWalletClient(),
    publicClient: opts.publicClient ?? buildPublicClient(),
  };
}

describe("performAction()", () => {
  it("happy path: redeem returns REDEEMED state", async () => {
    const signedPayload = await buildSignedPayload({ functionName: "redeemVoucher(uint256)" });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toEqual({
      ok: true,
      txHash: TX_HASH,
      newExchangeState: ACTION_POST_STATE["boson-redeem"].exchange,
      newDisputeState: undefined,
    });
  });

  it("rejects when signedPayload is malformed", async () => {
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload: "0xdead",
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when network is not in supportedNetworks", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: "eip155:137",
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
  });

  it("rejects when the network has no configured escrow allowlist entry", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      // Config has supportedNetworks but no matching escrow entry —
      // the allowlist gate should fire before any signature work.
      buildConfig({ escrows: {} }),
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/no escrow configured/i);
  });

  it("rejects when escrowAddress is not the configured Diamond for the network", async () => {
    const signedPayload = await buildSignedPayload();
    const ATTACKER_CONTRACT: Address = "0xcafecafecafecafecafecafecafecafecafecafe";
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ATTACKER_CONTRACT,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/not the configured Diamond/i);
  });

  it("rejects when action is not a known Boson action id", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-bogusAction" as unknown as ActionId,
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
  });

  it("rejects commit-time actions on the post-commit endpoint", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-createOfferAndCommit",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_ACTION" });
  });

  it("rejects when action does not match the signed functionName", async () => {
    const signedPayload = await buildSignedPayload({ functionName: "redeemVoucher(uint256)" });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-completeExchange",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when exchangeId does not match the signed calldata", async () => {
    const signedPayload = await buildSignedPayload({ exchangeId: "43" });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when functionSignature encodes a different post-commit action", async () => {
    const signedPayload = await buildSignedPayload({
      functionName: "redeemVoucher(uint256)",
      functionSignature: buildPostCommitCalldata("completeExchange(uint256)"),
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when meta-tx signature was produced by a different signer", async () => {
    // Sign as buyer but claim seller is the from-address — recovery
    // will return buyer, which doesn't match metaTx.from (seller).
    const signedPayload = await buildSignedPayload({ signer: buyer });
    // Mutate the decoded BosonMetaTx and re-encode so metaTx.from is
    // seller while the sig still corresponds to buyer.
    const { decodeSignedPayload } = await import("@bosonprotocol/x402-evm/codec");
    const decoded = decodeSignedPayload(signedPayload);
    const tampered = encodeSignedPayload({ ...decoded, from: seller.address });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload: tampered,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_META_TX_SIGNATURE" });
  });

  it("rejects when simulation reverts", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig({ publicClient: buildPublicClient({ callBehavior: "revert" }) }),
    );
    expect(result).toMatchObject({ ok: false, code: "SIMULATION_REVERT" });
  });

  it("rejects when receipt status is reverted", async () => {
    const signedPayload = await buildSignedPayload();
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
      },
      buildConfig({ publicClient: buildPublicClient({ receiptStatus: "reverted" }) }),
    );
    expect(result).toMatchObject({ ok: false, code: "ONCHAIN_REVERT" });
  });

  it("happy path: raiseDispute returns DISPUTED + RESOLVING state", async () => {
    const signedPayload = await buildSignedPayload({ functionName: "raiseDispute(uint256)" });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-raiseDispute",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toEqual({
      ok: true,
      txHash: TX_HASH,
      newExchangeState: ACTION_POST_STATE["boson-raiseDispute"].exchange,
      newDisputeState: ACTION_POST_STATE["boson-raiseDispute"].dispute,
    });
  });

  it("happy path: revokeVoucher (seller-signed) returns REVOKED state", async () => {
    const signedPayload = await buildSignedPayload({
      signer: seller,
      functionName: "revokeVoucher(uint256)",
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-revokeVoucher",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toEqual({
      ok: true,
      txHash: TX_HASH,
      newExchangeState: ACTION_POST_STATE["boson-revokeVoucher"].exchange,
      newDisputeState: undefined,
    });
  });

  it("happy path: completeExchange returns COMPLETED state", async () => {
    const signedPayload = await buildSignedPayload({
      functionName: "completeExchange(uint256)",
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-completeExchange",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toEqual({
      ok: true,
      txHash: TX_HASH,
      newExchangeState: ACTION_POST_STATE["boson-completeExchange"].exchange,
      newDisputeState: undefined,
    });
  });

  it("rejects non-'none' tokenAuthStrategy before token-auth validation", async () => {
    // BPIP-12 perform-action envelopes are not wired yet. Fail with the
    // stable unsupported-strategy code before token-auth signature/RPC work.
    const signedPayload = await buildSignedPayload({ functionName: "redeemVoucher(uint256)" });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-redeem",
        signedPayload,
        tokenAuthStrategy: "permit2",
        tokenAuth: {
          kind: "permit2",
          data: {
            permitted: { token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", amount: "100" },
            spender: ESCROW,
            nonce: "0",
            deadline: Math.floor(Date.now() / 1000) + 300,
            signature: `0x${"00".repeat(65)}`,
          },
        },
        asset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        amount: "100",
        maxTimeoutSeconds: 3600,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY" });
  });

  it("rejects when tokenAuth is present but strategy is 'none'", async () => {
    const signedPayload = await buildSignedPayload({
      functionName: "escalateDispute(uint256)",
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-escalateDispute",
        signedPayload,
        // Strategy defaults to "none" — tokenAuth must therefore be absent.
        tokenAuth: {
          kind: "permit2",
          data: {
            permitted: { token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", amount: "100" },
            spender: ESCROW,
            nonce: "0",
            deadline: Math.floor(Date.now() / 1000) + 300,
            signature: `0x${"00".repeat(65)}`,
          },
        },
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/must be omitted/i);
  });

  it("rejects when token-auth metadata is present but strategy is 'none'", async () => {
    const signedPayload = await buildSignedPayload({
      functionName: "escalateDispute(uint256)",
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-escalateDispute",
        signedPayload,
        asset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        amount: "100",
        maxTimeoutSeconds: 3600,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/must be omitted/i);
  });

  it("happy path: withdrawFunds returns just txHash (no exchange-state transition)", async () => {
    const signedPayload = await buildSignedPayload({
      signer: seller,
      functionName: "withdrawFunds(uint256,address[],uint256[])",
      functionSignature: buildWithdrawCalldata(),
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        entityId: ENTITY_ID,
        action: "boson-withdrawFunds",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toEqual({ ok: true, txHash: TX_HASH });
  });

  it("withdrawFunds rejects when entityId does not match the signed calldata", async () => {
    const signedPayload = await buildSignedPayload({
      signer: seller,
      functionName: "withdrawFunds(uint256,address[],uint256[])",
      functionSignature: buildWithdrawCalldata("100"),
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        entityId: ENTITY_ID,
        action: "boson-withdrawFunds",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("withdrawFunds rejects when entityId is not a uint256 decimal", async () => {
    const signedPayload = await buildSignedPayload({
      signer: seller,
      functionName: "withdrawFunds(uint256,address[],uint256[])",
      functionSignature: buildWithdrawCalldata(),
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        entityId: "0xabc",
        action: "boson-withdrawFunds",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("withdrawFunds rejects when functionName does not match", async () => {
    const signedPayload = await buildSignedPayload({
      signer: seller,
      functionName: "redeemVoucher(uint256)",
      functionSignature: buildPostCommitCalldata("redeemVoucher(uint256)"),
    });
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        entityId: ENTITY_ID,
        action: "boson-withdrawFunds",
        signedPayload,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("escalateDispute with tokenAuthStrategy 'permit2' returns UNSUPPORTED_TOKEN_AUTH_STRATEGY", async () => {
    const signedPayload = await buildSignedPayload({
      functionName: "escalateDispute(uint256)",
    });
    const ASSET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as `0x${string}`;
    const AMOUNT = "100";
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const result = await performAction(
      {
        network: NETWORK,
        escrowAddress: ESCROW,
        exchangeId: EXCHANGE_ID,
        action: "boson-escalateDispute",
        signedPayload,
        tokenAuthStrategy: "permit2",
        tokenAuth: {
          kind: "permit2",
          data: {
            permitted: { token: ASSET, amount: AMOUNT },
            spender: ESCROW,
            nonce: "0",
            deadline,
            signature: `0x${"00".repeat(65)}`,
          },
        },
        asset: ASSET,
        amount: AMOUNT,
        maxTimeoutSeconds: 3600,
      },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY" });
  });
});

describe("encodeSignedPayload / decodeSignedPayload", () => {
  it("round-trips a BosonMetaTx", async () => {
    const { decodeSignedPayload } = await import("@bosonprotocol/x402-evm/codec");
    const original = {
      from: buyer.address,
      nonce: "42",
      functionName: "redeemVoucher(uint256)",
      functionSignature: "0xcafebabe" as Hex,
      sig: {
        v: 27,
        r: `0x${"aa".repeat(32)}` as Hex,
        s: `0x${"bb".repeat(32)}` as Hex,
      },
    };
    const encoded = encodeSignedPayload(original);
    const decoded = decodeSignedPayload(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("deriveNewState", () => {
  it("matches ACTION_POST_STATE for every action id", async () => {
    const { deriveNewState } = await import("../src/perform-action/new-state.js");
    for (const action of Object.keys(ACTION_POST_STATE) as ActionId[]) {
      const expected = ACTION_POST_STATE[action];
      const got = deriveNewState(action);
      expect(got.newExchangeState).toBe(expected.exchange);
      expect(got.newDisputeState).toBe(expected.dispute);
    }
  });
});

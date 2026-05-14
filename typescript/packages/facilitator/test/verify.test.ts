import { permit2TypedData } from "@bosonprotocol/x402-core/eip712/token-auth";
import { describe, expect, it } from "vitest";
import {
  BaseError,
  RawContractError,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";

import { verify } from "../src/verify/index.js";
import type { FacilitatorConfig } from "../src/types.js";

import {
  AMOUNT,
  ASSET,
  buildValidPayload,
  buildValidRequirements,
  buyer,
  CHAIN_ID,
  ESCROW,
  fullOffer,
  NETWORK,
  relayer,
} from "./fixtures.js";

/**
 * Build a PublicClient stub whose `call` is configurable per test.
 *
 * `callBehavior: "revert"` throws a viem `BaseError` whose cause chain
 * contains a `RawContractError` — this matches the structure viem
 * produces for an actual on-chain revert and lets
 * `simulateExecuteMetaTransaction`'s revert-discrimination logic
 * recognise the failure as `SIMULATION_REVERT` (rather than
 * `INTERNAL_ERROR`, which is reserved for transport-layer failures).
 *
 * `callBehavior: "rpc-error"` throws a plain `Error` to exercise the
 * non-revert branch.
 */
function buildPublicClient(
  opts: {
    callBehavior?: "pass" | "revert" | "rpc-error";
    revertReason?: string;
    rpcErrorMessage?: string;
  } = {},
): PublicClient {
  return {
    call: async () => {
      if (opts.callBehavior === "revert") {
        const reason = opts.revertReason ?? "execution reverted: nonce already used";
        const rawRevert = new RawContractError({ message: reason });
        throw new BaseError("Execution reverted", { cause: rawRevert });
      }
      if (opts.callBehavior === "rpc-error") {
        throw new Error(opts.rpcErrorMessage ?? "ECONNREFUSED: RPC unreachable");
      }
      return { data: "0x" };
    },
    readContract: async () => {
      throw new Error("readContract not stubbed");
    },
  } as unknown as PublicClient;
}

function buildConfig(opts: { client?: PublicClient } = {}): FacilitatorConfig {
  const walletClient = { account: { address: relayer.address } } as unknown as WalletClient;
  return {
    url: "https://facilitator.example",
    supportedNetworks: [NETWORK],
    escrows: { [NETWORK]: ESCROW },
    walletClient,
    publicClient: opts.client ?? buildPublicClient({ callBehavior: "pass" }),
  };
}

async function buildValidPermit2TokenAuth(deadline: number = Math.floor(Date.now() / 1000) + 300) {
  const message = {
    permitted: { token: ASSET, amount: BigInt(AMOUNT) },
    spender: ESCROW,
    nonce: 0n,
    deadline: BigInt(deadline),
  };
  const typedData = permit2TypedData({ chainId: CHAIN_ID, message });
  const signature = await buyer.signTypedData(typedData);
  return {
    kind: "permit2" as const,
    data: {
      permitted: { token: ASSET, amount: AMOUNT },
      spender: ESCROW,
      nonce: "0",
      deadline,
      signature,
    },
  };
}

describe("verify()", () => {
  it("happy path: structurally-valid payload with valid meta-tx signature + passing simulation", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects when network is not in supportedNetworks", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig();
    const result = await verify(
      { scheme: "escrow", network: "eip155:137", payload, requirements },
      { ...config, supportedNetworks: [NETWORK] },
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
  });

  it("rejects when input.network does not match payload.network", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const result = await verify(
      {
        scheme: "escrow",
        network: NETWORK,
        payload: { ...payload, network: "eip155:137" },
        requirements,
      },
      { ...buildConfig(), supportedNetworks: [NETWORK, "eip155:137"] },
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
  });

  it("rejects when payload.action is not in requirements.actions.next[].id", async () => {
    const payload = await buildValidPayload();
    const requirements = {
      ...buildValidRequirements(),
      actions: { next: [{ id: "boson-redeem", channels: ["server" as const] }] },
    };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "ACTION_NOT_IN_REQUIREMENTS" });
  });

  it("rejects when payload.tokenAuthStrategy is not in requirements.tokenAuthStrategies", async () => {
    const payload = await buildValidPayload();
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["permit" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "TOKEN_AUTH_NOT_IN_REQUIREMENTS" });
  });

  it("rejects when the network has no configured escrow allowlist entry", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      { ...config, escrows: {} },
    );
    expect(result).toMatchObject({ ok: false, code: "NETWORK_MISMATCH" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/no escrow configured/i);
  });

  it("rejects when requirements.escrowAddress is not the configured Diamond", async () => {
    const payload = await buildValidPayload();
    const ATTACKER_CONTRACT: Address = "0xcafecafecafecafecafecafecafecafecafecafe";
    // The seller advertised a different escrow than the operator's
    // allowlist — could be a malicious seller trying to direct the
    // relayer at an arbitrary contract.
    const requirements = { ...buildValidRequirements(), escrowAddress: ATTACKER_CONTRACT };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/not the configured Diamond/i);
  });

  it("rejects when payload.offerRef does not match requirements.offer", async () => {
    const payload = await buildValidPayload();
    payload.payload.offerRef.fullOffer = { ...fullOffer, price: "2" };
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when meta-tx calldata does not encode the required offer", async () => {
    const payload = await buildValidPayload();
    payload.payload.metaTx.functionSignature = "0xdeadbeef";
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects when meta-tx signature was produced by a different signer", async () => {
    const payload = await buildValidPayload();
    // Pretend a different EOA is the claimed buyer — recovery will then
    // mismatch the payload.buyer.
    const wrongBuyer: Address = "0xabcdef1234567890abcdef1234567890abcdef12";
    payload.payload.buyer = wrongBuyer;
    payload.payload.metaTx.from = wrongBuyer;
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_META_TX_SIGNATURE" });
  });

  it("rejects when meta-tx signature v is not 27/28", async () => {
    const payload = await buildValidPayload();
    payload.payload.metaTx.sig.v = 0;
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_META_TX_SIGNATURE" });
  });

  it("rejects when simulation reverts", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      client: buildPublicClient({
        callBehavior: "revert",
        revertReason: "execution reverted: USED_NONCE",
      }),
    });
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "SIMULATION_REVERT" });
    expect((result as { ok: false; reason: string }).reason).toContain("USED_NONCE");
  });

  it("maps RPC / transport failures to INTERNAL_ERROR (not SIMULATION_REVERT)", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const config = buildConfig({
      client: buildPublicClient({
        callBehavior: "rpc-error",
        rpcErrorMessage: "fetch failed: ECONNREFUSED",
      }),
    });
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      config,
    );
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect((result as { ok: false; reason: string }).reason).toContain("ECONNREFUSED");
  });

  it("rejects when input.scheme is wrong", async () => {
    const payload = await buildValidPayload();
    const requirements = buildValidRequirements();
    const result = await verify(
      // Cast through unknown to bypass the type guard — exercising the
      // runtime check for callers that bypass TS.
      {
        scheme: "exact",
        network: NETWORK,
        payload,
        requirements,
      } as unknown as Parameters<typeof verify>[0],
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "SCHEME_MISMATCH" });
  });

  it("rejects when tokenAuth is present but strategy is 'none'", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuth = {
      kind: "permit",
      data: {
        owner: buyer.address,
        spender: ESCROW,
        value: "100",
        deadline: 9999999999,
        nonce: "0",
        v: 27,
        r: "0x00",
        s: "0x00",
      },
    };
    const requirements = buildValidRequirements();
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("rejects token-auth when the signed amount does not match requirements.amount", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "permit2";
    payload.payload.tokenAuth = await buildValidPermit2TokenAuth();
    payload.payload.tokenAuth.data.permitted.amount = "1";
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["permit2" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_TOKEN_AUTH_SIGNATURE" });
  });

  it("rejects token-auth when the deadline exceeds maxTimeoutSeconds", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "permit2";
    payload.payload.tokenAuth = await buildValidPermit2TokenAuth(
      Math.floor(Date.now() / 1000) + 7200,
    );
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["permit2" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_TOKEN_AUTH_SIGNATURE" });
  });

  it("rejects token-auth when the deadline is already in the past", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "permit2";
    // Sign a permit whose deadline already elapsed. The recovery itself
    // succeeds (signing is timeless); the past-deadline guard inside
    // validateDeadlineWindow must catch this in `verify()`, ahead of
    // any on-chain simulation that would otherwise surface a less
    // actionable SIMULATION_REVERT.
    payload.payload.tokenAuth = await buildValidPermit2TokenAuth(
      Math.floor(Date.now() / 1000) - 60,
    );
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["permit2" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_TOKEN_AUTH_SIGNATURE" });
    expect((result as { ok: false; reason: string }).reason).toContain("expired");
  });

  it("rejects ERC-3009 token-auth when validAfter is in the future", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "erc3009";
    // EIP-3009 requires `block.timestamp > validAfter` strictly; a
    // future validAfter means the authorization isn't active yet and
    // the on-chain transferWithAuthorization call would revert. Catch
    // it in verify so callers get BAD_TOKEN_AUTH_SIGNATURE instead of
    // letting it slip through to simulation. The validAfter check
    // fires before signature recovery, so this test can use placeholder
    // r/s/v without setting up a real ERC-3009 sign flow.
    payload.payload.tokenAuth = {
      kind: "erc3009",
      data: {
        from: buyer.address,
        to: ESCROW,
        value: "1000000",
        validAfter: Math.floor(Date.now() / 1000) + 3600,
        validBefore: Math.floor(Date.now() / 1000) + 7200,
        nonce: `0x${"00".repeat(32)}`,
        v: 27,
        r: `0x${"aa".repeat(32)}`,
        s: `0x${"bb".repeat(32)}`,
      },
    };
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["erc3009" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "BAD_TOKEN_AUTH_SIGNATURE" });
    expect((result as { ok: false; reason: string }).reason).toMatch(/validAfter|not yet/i);
  });

  it("maps RPC failures during token-domain lookup to INTERNAL_ERROR", async () => {
    // Drive an ERC-3009 path far enough that fetchTokenDomain runs.
    // The eip712Domain() / name() / version() reads on the token go
    // through publicClient.readContract — stub it to throw a plain
    // Error (not a ContractFunctionExecutionError), which simulates an
    // RPC transport failure rather than a missing-method revert.
    // The fix bubbles that through verifyErc3009's wrapper as
    // INTERNAL_ERROR instead of letting it escape Promise<StepResult>.
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "erc3009";
    payload.payload.tokenAuth = {
      kind: "erc3009",
      data: {
        from: buyer.address,
        to: ESCROW,
        value: "1000000",
        validAfter: Math.floor(Date.now() / 1000) - 60,
        validBefore: Math.floor(Date.now() / 1000) + 600,
        nonce: `0x${"00".repeat(32)}`,
        v: 27,
        r: `0x${"aa".repeat(32)}`,
        s: `0x${"bb".repeat(32)}`,
      },
    };
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["erc3009" as const] };
    const rpcFailing = {
      ...buildPublicClient(),
      readContract: async () => {
        throw new Error("ECONNREFUSED: token RPC unreachable");
      },
    } as unknown as PublicClient;
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig({ client: rpcFailing }),
    );
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect((result as { ok: false; reason: string }).reason).toContain("ECONNREFUSED");
  });

  it("returns UNSUPPORTED_TOKEN_AUTH_STRATEGY for valid token-auth while BPIP-12 simulation is deferred", async () => {
    const payload = await buildValidPayload();
    payload.payload.tokenAuthStrategy = "permit2";
    payload.payload.tokenAuth = await buildValidPermit2TokenAuth();
    const requirements = { ...buildValidRequirements(), tokenAuthStrategies: ["permit2" as const] };
    const result = await verify(
      { scheme: "escrow", network: NETWORK, payload, requirements },
      buildConfig(),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TOKEN_AUTH_STRATEGY" });
  });
});

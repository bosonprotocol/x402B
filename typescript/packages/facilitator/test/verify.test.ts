import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it } from "vitest";
import { parseSignature, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { verify } from "../src/verify/index.js";
import type { FacilitatorConfig } from "../src/types.js";

// Fixed test vectors — deterministic across runs.
const BUYER_PK = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const buyer = privateKeyToAccount(BUYER_PK);
const RELAYER_PK = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" as const;
const relayer = privateKeyToAccount(RELAYER_PK);

const ESCROW: Address = "0xdddddddddddddddddddddddddddddddddddddddd";
const ASSET: Address = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const CHAIN_ID = 1;
const NETWORK = `eip155:${CHAIN_ID}`;
const FUNCTION_NAME = "createOfferAndCommit(...)";
const FUNCTION_SIGNATURE: Hex = "0xdeadbeef";
const NONCE = "1";

/** Build a fully-signed EscrowPaymentPayload for `tokenAuthStrategy: "none"`. */
async function buildValidPayload(): Promise<EscrowPaymentPayload> {
  const typedData = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: BigInt(NONCE),
      from: buyer.address,
      contractAddress: ESCROW,
      functionName: FUNCTION_NAME,
      functionSignature: FUNCTION_SIGNATURE,
    },
  });
  const sig = await buyer.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const parsed = parseSignature(sig);
  // viem returns v=27/28 only when yParity is set; normalise to 27/28 form
  // explicitly so the buyer's BosonMetaTx field matches the on-chain
  // LibSignature.recover expectation.
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;
  return {
    x402Version: 1,
    scheme: "escrow",
    network: NETWORK,
    payload: {
      action: "boson-createOfferAndCommit",
      tokenAuthStrategy: "none",
      offerRef: { fullOffer: {}, sellerSig: "0x00" },
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: NONCE,
        functionName: FUNCTION_NAME,
        functionSignature: FUNCTION_SIGNATURE,
        sig: { v, r: parsed.r, s: parsed.s },
      },
    },
  };
}

/** Build matching requirements. */
function buildValidRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: NETWORK,
    asset: ASSET,
    amount: "1000000",
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:42",
    maxTimeoutSeconds: 3600,
    offer: {
      fullOffer: {},
      sellerSig: "0x00",
      creator: "0x1111111111111111111111111111111111111111",
    },
    tokenAuthStrategies: ["none"],
    actions: {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain"],
        },
      ],
    },
  };
}

/** Build a PublicClient stub whose `call` is configurable per test. */
function buildPublicClient(
  opts: {
    callBehavior?: "pass" | "revert";
    revertReason?: string;
  } = {},
): PublicClient {
  return {
    call: async () => {
      if (opts.callBehavior === "revert") {
        const e = new Error("execution reverted: nonce already used") as Error & {
          shortMessage?: string;
        };
        e.shortMessage = opts.revertReason ?? "execution reverted: nonce already used";
        throw e;
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
    walletClient,
    publicClient: opts.client ?? buildPublicClient({ callBehavior: "pass" }),
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
});

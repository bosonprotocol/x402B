// Round-trip test for the `handle402` entrypoint.
//
// Feeds an `EscrowPaymentRequirements` shaped after the spec example, runs
// `handle402` with a deterministic viem `LocalAccount`, decodes the base64
// `X-PAYMENT` value back to the structured payload, and asserts the
// docs/boson-impl-01-escrow-scheme.md §5 validation rules pass locally.
//
// The `requirements.offer.fullOffer` carries a full `Omit<FullOfferArgs,
// "signature">` shape so core-sdk's yup validation inside
// `signMetaTxCreateOfferAndCommit` accepts it.

import { describe, expect, it } from "vitest";
import {
  parseEscrowPaymentPayload,
  type EscrowPaymentRequirements,
  type Erc3009AuthData,
  type Permit2AuthData,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { PERMIT2_ADDRESS } from "@bosonprotocol/x402-core/eip712/token-auth";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createX402bClient } from "../src/client.js";
import {
  MaxAmountExceededError,
  NotImplementedError,
  UnsupportedTokenAuthError,
} from "../src/errors.js";
import type { Signer } from "../src/types.js";

const TEST_KEY = `0x${"42".repeat(32)}` as const;
const BUYER_ACCOUNT = privateKeyToAccount(TEST_KEY);

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ESCROW = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const SELLER = "0x1111111111111111111111111111111111111111" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const SELLER_SIG = "0xdeadbeef"; // opaque; protocol verifies on-chain

// `validUntilDateInMS` must be in the future for core-sdk's yup validator.
const NOW_MS = Date.now();
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const VALID_UNTIL = NOW_MS + ONE_YEAR_MS;

const fullOffer = {
  price: "1000000",
  sellerDeposit: "0",
  agentId: "0",
  buyerCancelPenalty: "0",
  quantityAvailable: "1",
  validFromDateInMS: NOW_MS.toString(),
  validUntilDateInMS: VALID_UNTIL.toString(),
  voucherRedeemableFromDateInMS: NOW_MS.toString(),
  voucherRedeemableUntilDateInMS: (VALID_UNTIL + ONE_YEAR_MS).toString(),
  voucherValidDurationInMS: "0", // exactly one of {voucherValidDurationInMS, voucherRedeemableUntilDateInMS} must be non-zero
  disputePeriodDurationInMS: (7 * 24 * 60 * 60 * 1000).toString(),
  resolutionPeriodDurationInMS: (7 * 24 * 60 * 60 * 1000).toString(),
  exchangeToken: USDC_BASE,
  disputeResolverId: "1",
  metadataUri: "ipfs://bafyabc",
  metadataHash: "0xabcd",
  collectionIndex: "0",
  offerCreator: SELLER,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: ZERO,
    gatingType: 0,
    minTokenId: "0",
    maxTokenId: "0",
    threshold: "0",
    maxCommits: "0",
  },
  useDepositedFunds: false,
  sellerId: "1",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: ZERO,
  },
};

function baseRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: "eip155:8453",
    asset: USDC_BASE,
    amount: "1000000",
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:1",
    maxTimeoutSeconds: 300,
    offer: { fullOffer, sellerSig: SELLER_SIG, creator: SELLER },
    tokenAuthStrategies: ["erc3009"],
    actions: {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain"],
          endpoints: { server: "https://seller.example/x402B/commit" },
        },
      ],
    },
  };
}

const BUYER_SIGNER: Signer = {
  getAddress: async () => BUYER_ACCOUNT.address,
  signTypedData: (args) =>
    BUYER_ACCOUNT.signTypedData(args as Parameters<typeof BUYER_ACCOUNT.signTypedData>[0]),
};

function makeClient() {
  return createX402bClient({
    signer: BUYER_SIGNER,
    tokenDomainResolver: async (asset, chainId) => ({
      name: "USD Coin",
      version: "2",
      chainId,
      verifyingContract: asset,
    }),
  });
}

describe("handle402 — round-trip", () => {
  it("produces a base64 payload that re-parses as EscrowPaymentPayload", async () => {
    const client = makeClient();
    const header = await client.handle402(baseRequirements());

    expect(typeof header).toBe("string");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(() => parseEscrowPaymentPayload(decoded)).not.toThrow();
  });

  it("payload satisfies §5 validation rules 1, 2, 3, 4, 5, 6, 7, 8, 9 locally", async () => {
    const requirements = baseRequirements();
    const client = makeClient();
    const header = await client.handle402(requirements);
    const decoded = parseEscrowPaymentPayload(
      JSON.parse(Buffer.from(header, "base64").toString("utf8")),
    );

    // 1. scheme equality
    expect(decoded.scheme).toBe("escrow");
    expect(decoded.scheme).toBe(requirements.scheme);

    // 2. network equality
    expect(decoded.network).toBe(requirements.network);

    // 3. echoed fullOffer matches requirements
    expect(decoded.payload.offerRef.fullOffer).toEqual(requirements.offer.fullOffer);

    // 4. echoed sellerSig matches requirements
    expect(decoded.payload.offerRef.sellerSig).toBe(requirements.offer.sellerSig);

    // 5. action is in requirements.actions.next[]
    expect(requirements.actions.next.some((a) => a.id === decoded.payload.action)).toBe(true);

    // 6. tokenAuthStrategy is in requirements.tokenAuthStrategies
    expect(requirements.tokenAuthStrategies).toContain(decoded.payload.tokenAuthStrategy);

    // 7. metaTx.functionName encodes createOfferAndCommit
    expect(decoded.payload.metaTx.functionName.startsWith("createOfferAndCommit(")).toBe(true);

    // 8. buyer matches account; nonce + functionSignature are present
    expect(decoded.payload.buyer.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
    expect(decoded.payload.metaTx.from.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
    expect(decoded.payload.metaTx.nonce).toMatch(/^\d+$/);
    expect(decoded.payload.metaTx.functionSignature.startsWith("0x")).toBe(true);

    // 9. ERC-3009 token-auth shape (assert escrow `to`, exact `value`, and `validBefore` window)
    expect(decoded.payload.tokenAuth?.kind).toBe("erc3009");
    const tokenAuth = decoded.payload.tokenAuth?.data as Erc3009AuthData;
    expect(tokenAuth.to.toLowerCase()).toBe(requirements.escrowAddress.toLowerCase());
    expect(tokenAuth.value).toBe(requirements.amount);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(tokenAuth.validBefore - nowSec).toBeLessThanOrEqual(requirements.maxTimeoutSeconds + 5);
    expect(tokenAuth.validBefore - nowSec).toBeGreaterThan(0);
  });

  it("ERC-3009 signature recovers to the buyer account", async () => {
    const requirements = baseRequirements();
    const client = makeClient();
    const header = await client.handle402(requirements);
    const decoded = parseEscrowPaymentPayload(
      JSON.parse(Buffer.from(header, "base64").toString("utf8")),
    );
    const tokenAuth = decoded.payload.tokenAuth?.data as Erc3009AuthData;

    // Re-build the typed-data exactly as the client did and recover the signer.
    const signature = `0x${tokenAuth.r.slice(2)}${tokenAuth.s.slice(2)}${tokenAuth.v
      .toString(16)
      .padStart(2, "0")}` as `0x${string}`;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: requirements.asset as `0x${string}`,
      },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: tokenAuth.from as `0x${string}`,
        to: tokenAuth.to as `0x${string}`,
        value: BigInt(tokenAuth.value),
        validAfter: BigInt(tokenAuth.validAfter),
        validBefore: BigInt(tokenAuth.validBefore),
        nonce: tokenAuth.nonce as `0x${string}`,
      },
      signature,
    });
    expect(recovered.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
  });

  it("rejects requirements offering only boson-createOfferCommitAndRedeem with NotImplementedError", async () => {
    const requirements = baseRequirements();
    requirements.actions.next = [{ id: "boson-createOfferCommitAndRedeem", channels: ["server"] }];
    const client = makeClient();
    await expect(client.handle402(requirements)).rejects.toThrow(NotImplementedError);
  });

  it("rejects requirements that only advertise the 'none' strategy (no client-side signing)", async () => {
    const requirements = baseRequirements();
    requirements.tokenAuthStrategies = ["none"];
    const client = makeClient();
    await expect(client.handle402(requirements)).rejects.toThrow(UnsupportedTokenAuthError);
  });

  it("rejects 'permit' when no PublicClient is configured for the chain", async () => {
    const requirements = baseRequirements();
    requirements.tokenAuthStrategies = ["permit"];
    const client = makeClient();
    await expect(client.handle402(requirements)).rejects.toThrow(UnsupportedTokenAuthError);
  });

  it("signs Permit2 when the server advertises only 'permit2'", async () => {
    const requirements = baseRequirements();
    requirements.tokenAuthStrategies = ["permit2"];
    const client = makeClient();
    const header = await client.handle402(requirements);
    const decoded = parseEscrowPaymentPayload(
      JSON.parse(Buffer.from(header, "base64").toString("utf8")),
    );

    expect(decoded.payload.tokenAuthStrategy).toBe("permit2");
    expect(decoded.payload.tokenAuth?.kind).toBe("permit2");
    const tokenAuth = decoded.payload.tokenAuth?.data as Permit2AuthData;
    expect(tokenAuth.permitted.token.toLowerCase()).toBe(requirements.asset.toLowerCase());
    expect(tokenAuth.permitted.amount).toBe(requirements.amount);
    expect(tokenAuth.spender.toLowerCase()).toBe(requirements.escrowAddress.toLowerCase());
    expect(tokenAuth.nonce).toMatch(/^\d+$/);
    expect(tokenAuth.signature).toMatch(/^0x[0-9a-f]{130}$/);

    // Signature recovers to the buyer against Permit2's canonical domain.
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: PERMIT2_ADDRESS,
      },
      types: {
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      primaryType: "PermitTransferFrom",
      message: {
        permitted: {
          token: tokenAuth.permitted.token as `0x${string}`,
          amount: BigInt(tokenAuth.permitted.amount),
        },
        spender: tokenAuth.spender as `0x${string}`,
        nonce: BigInt(tokenAuth.nonce),
        deadline: BigInt(tokenAuth.deadline),
      },
      signature: tokenAuth.signature as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(BUYER_ACCOUNT.address.toLowerCase());
  });

  it("rejects requirements whose amount exceeds policy.maxAmount before signing", async () => {
    const requirements = baseRequirements();
    requirements.amount = "1000001";
    const client = createX402bClient({
      signer: BUYER_SIGNER,
      policy: { maxAmount: "1000000" },
    });

    await expect(client.handle402(requirements)).rejects.toThrow(MaxAmountExceededError);
  });
});

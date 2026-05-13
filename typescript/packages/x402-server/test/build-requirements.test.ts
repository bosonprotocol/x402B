// `buildPaymentRequirements` + `createX402bServer` end-to-end:
// signs a FullOffer, builds the 402 body, asserts it round-trips
// through `escrowPaymentRequirementsSchema`, and that the embedded
// `actions.next[]` carries the two `PRE_COMMIT` legal transitions.

import { buildChannelRegistry } from "@bosonprotocol/x402-actions";
import { escrowPaymentRequirementsSchema } from "@bosonprotocol/x402-core/schemes/escrow";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { buildPaymentRequirements, createX402bServer, signFullOffer } from "../src/index.js";
import { baseOffer, ESCROW, TEST_SELLER_PK, TOKEN } from "./fixtures.js";

const CHAIN_ID = 8453;
const NETWORK = "eip155:8453" as const;
const RECIPIENT_ID = "did:boson:seller:12345";

function makeRegistry() {
  return buildChannelRegistry({
    channels: ["server", "facilitator", "onchain", "mcp"],
    escrow: ESCROW,
    mcp: "boson://seller/12345",
  });
}

describe("buildPaymentRequirements (free function)", () => {
  it("emits a valid EscrowPaymentRequirements with initial nextActions", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const offer = await signFullOffer({
      fullOffer: { ...baseOffer, offerCreator: seller.address },
      signer: seller,
      escrow: ESCROW,
      chainId: CHAIN_ID,
    });

    const requirements = buildPaymentRequirements({
      offer,
      asset: TOKEN,
      amount: "1000000",
      tokenAuthStrategies: ["erc3009"],
      recipientId: RECIPIENT_ID,
      maxTimeoutSeconds: 300,
      network: NETWORK,
      escrow: ESCROW,
      channelRegistry: makeRegistry(),
    });

    expect(() => escrowPaymentRequirementsSchema.parse(requirements)).not.toThrow();
    expect(requirements.scheme).toBe("escrow");
    expect(requirements.network).toBe(NETWORK);
    expect(requirements.escrowAddress).toBe(ESCROW);
    expect(requirements.offer.sellerSig).toMatch(/^0x[0-9a-f]+$/);

    const actionIds = requirements.actions.next.map((entry) => entry.id);
    expect(actionIds).toContain("boson-createOfferAndCommit");
    expect(actionIds).toContain("boson-createOfferCommitAndRedeem");
  });

  it("omits `fulfillment` when not supplied", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const offer = await signFullOffer({
      fullOffer: baseOffer,
      signer: seller,
      escrow: ESCROW,
      chainId: CHAIN_ID,
    });

    const requirements = buildPaymentRequirements({
      offer,
      asset: TOKEN,
      amount: "1000000",
      tokenAuthStrategies: ["none"],
      recipientId: RECIPIENT_ID,
      maxTimeoutSeconds: 300,
      network: NETWORK,
      escrow: ESCROW,
      channelRegistry: makeRegistry(),
    });

    expect(requirements.fulfillment).toBeUndefined();
  });
});

describe("createX402bServer", () => {
  it("binds config to a buildPaymentRequirements() that signs offers on demand", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: "https://facilitator.example" },
      channelRegistry: makeRegistry(),
    });

    const requirements = await server.buildPaymentRequirements({
      offer: { unsigned: { ...baseOffer, offerCreator: seller.address } },
      asset: TOKEN,
      amount: "1000000",
      tokenAuthStrategies: ["erc3009"],
      recipientId: RECIPIENT_ID,
      maxTimeoutSeconds: 300,
    });

    expect(requirements.offer.creator.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(() => escrowPaymentRequirementsSchema.parse(requirements)).not.toThrow();
  });

  it("advertises facilitator endpoints for facilitator-channel commit actions", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: "https://facilitator.example" },
      channelRegistry: makeRegistry(),
    });

    const requirements = await server.buildPaymentRequirements({
      offer: { unsigned: { ...baseOffer, offerCreator: seller.address } },
      asset: TOKEN,
      amount: "1000000",
      tokenAuthStrategies: ["erc3009"],
      recipientId: RECIPIENT_ID,
      maxTimeoutSeconds: 300,
    });

    for (const entry of requirements.actions.next) {
      expect(entry.channels).toContain("facilitator");
      expect(entry.endpoints?.facilitator).toBe("https://facilitator.example/settle");
    }
    expect(() => escrowPaymentRequirementsSchema.parse(requirements)).not.toThrow();
  });

  it("rejects config when escrow and channelRegistry.escrow disagree", () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const otherDiamond = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: buildChannelRegistry({
          channels: ["server", "facilitator", "onchain"],
          escrow: otherDiamond,
        }),
      }),
    ).toThrow(/does not match channelRegistry.escrow/);
  });

  it("rejects malformed channel registries at server creation", () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    expect(() =>
      createX402bServer({
        network: NETWORK,
        chainId: CHAIN_ID,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: {
          channels: ["facilitator", "unknown-channel"],
          escrow: ESCROW,
        } as never,
      }),
    ).toThrow();
  });

  it("rejects config when chainId doesn't match the network's CAIP-2 chainId", () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    expect(() =>
      createX402bServer({
        network: "eip155:8453",
        chainId: 1,
        escrow: ESCROW,
        signer: seller,
        facilitator: { url: "https://facilitator.example" },
        channelRegistry: makeRegistry(),
      }),
    ).toThrow(/chainId \(1\) must match network \(eip155:8453\)/);
  });

  it("normalises trailing slashes and URL-encodes action ids in facilitator endpoints", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);
    const server = createX402bServer({
      network: NETWORK,
      chainId: CHAIN_ID,
      escrow: ESCROW,
      signer: seller,
      facilitator: { url: "https://facilitator.example///" },
      channelRegistry: makeRegistry(),
    });

    const requirements = await server.buildPaymentRequirements({
      offer: { unsigned: { ...baseOffer, offerCreator: seller.address } },
      asset: TOKEN,
      amount: "1000000",
      tokenAuthStrategies: ["erc3009"],
      recipientId: RECIPIENT_ID,
      maxTimeoutSeconds: 300,
    });

    for (const entry of requirements.actions.next) {
      // No double-slash anywhere after the protocol.
      expect(entry.endpoints?.facilitator).not.toMatch(/[^:]\/\//);
      // Commit-time actions route to /settle; future post-commit
      // actions advertised here would route to /perform-action?action=
      // with the id URL-encoded.
      expect(entry.endpoints?.facilitator).toBe("https://facilitator.example/settle");
    }
  });
});

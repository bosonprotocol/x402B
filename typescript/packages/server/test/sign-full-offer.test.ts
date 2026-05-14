// `signFullOffer` round-trips through `recoverFullOfferSigner` from
// `@bosonprotocol/x402-core/eip712` — confirming we're producing a
// signature against the same domain the on-chain `verifyOffer` uses.

import { recoverFullOfferSigner } from "@bosonprotocol/x402-core/eip712";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { signFullOffer } from "../src/index.js";
import { baseOffer, ESCROW, TEST_SELLER_PK } from "./fixtures.js";

const CHAIN_ID = 8453;

describe("signFullOffer", () => {
  it("returns a BosonOfferRef whose signature recovers to the signer", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);

    const offerRef = await signFullOffer({
      fullOffer: { ...baseOffer, offerCreator: seller.address },
      signer: seller,
      escrow: ESCROW,
      chainId: CHAIN_ID,
    });

    expect(offerRef.creator.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(offerRef.sellerSig).toMatch(/^0x[0-9a-f]+$/);

    const recovered = await recoverFullOfferSigner({
      fullOffer: { ...baseOffer, offerCreator: seller.address },
      verifyingContract: ESCROW,
      chainId: CHAIN_ID,
      signature: offerRef.sellerSig as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(seller.address.toLowerCase());
  });

  it("echoes the unsigned offer through verbatim", async () => {
    const seller = privateKeyToAccount(TEST_SELLER_PK);

    const offerRef = await signFullOffer({
      fullOffer: baseOffer,
      signer: seller,
      escrow: ESCROW,
      chainId: CHAIN_ID,
    });

    expect(offerRef.fullOffer).toEqual(baseOffer);
  });
});

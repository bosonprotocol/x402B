// Unit tests for the harness actors. No Docker, no RPC — every viem
// client / CoreSDK is stubbed. Exercises the shape of each actor's
// public surface so a downstream scenario test that consumes the
// harness gets a clear error if a field gets renamed.

import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { ROLE_ACCOUNTS } from "../../src/config/accounts.js";
import { createBuyerActor } from "../../src/harness/buyer-actor.js";
import { createResolverActor } from "../../src/harness/resolver-actor.js";
import { createSellerActor } from "../../src/harness/seller-actor.js";

describe("BuyerActor", () => {
  it("exposes the wallet address + a wrapped fetch", () => {
    const account = privateKeyToAccount(ROLE_ACCOUNTS.buyer.privateKey);
    const actor = createBuyerActor({ account });
    expect(actor.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(typeof actor.fetch).toBe("function");
    expect(actor.client).toBeDefined();
    expect(actor.publicClient).toBeDefined();
  });
});

describe("SellerActor", () => {
  it("exposes the wallet address + a SellerSigner shape", () => {
    const account = privateKeyToAccount(ROLE_ACCOUNTS.seller.privateKey);
    const actor = createSellerActor({ account });
    expect(actor.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(actor.signer.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(typeof actor.signer.signTypedData).toBe("function");
    expect(typeof actor.signOffer).toBe("function");
  });
});

describe("ResolverActor", () => {
  it("defaults entityId to the upstream stack's pre-deployed DR (id=1)", () => {
    const account = privateKeyToAccount(ROLE_ACCOUNTS.resolver.privateKey);
    const actor = createResolverActor({ account });
    expect(actor.entityId).toBe("1");
    expect(actor.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("respects an explicit entityId override", () => {
    const account = privateKeyToAccount(ROLE_ACCOUNTS.resolver.privateKey);
    const actor = createResolverActor({ account, entityId: "42" });
    expect(actor.entityId).toBe("42");
  });
});

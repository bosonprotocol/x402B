// Unit tests for `signerFromWalletClient`.
//
// Drives the wrapper with a stubbed viem-shaped wallet client so the
// assertions focus on the adapter's behaviour: account resolution,
// override precedence, fail-fast on missing account, and faithful
// forwarding of the typed-data payload (with the resolved account
// injected) to the underlying `signTypedData` call.

import { describe, expect, it, vi, type Mock } from "vitest";

import { signerFromWalletClient, type WalletClientLike } from "../src/signer-from-wallet-client.js";
import {
  ALICE_CHECKSUM,
  ALICE_LOWER,
  BOB_CHECKSUM,
  BOB_LOWER,
  sampleTypedData,
} from "./fixtures.js";

function makeWalletClient(account?: {
  address: `0x${string}`;
}): WalletClientLike & { signTypedData: Mock } {
  return {
    account,
    signTypedData: vi.fn().mockResolvedValue("0xdeadbeef"),
  };
}

describe("signerFromWalletClient", () => {
  it("resolves getAddress from the wallet client's bound account (checksummed)", async () => {
    const signer = signerFromWalletClient(makeWalletClient({ address: ALICE_LOWER }));
    expect(await signer.getAddress()).toBe(ALICE_CHECKSUM);
  });

  it("the explicit `account` option overrides any bound wallet account", async () => {
    const signer = signerFromWalletClient(makeWalletClient({ address: ALICE_LOWER }), {
      account: BOB_LOWER,
    });
    expect(await signer.getAddress()).toBe(BOB_CHECKSUM);
  });

  it("throws synchronously when neither bound account nor override is provided", () => {
    expect(() => signerFromWalletClient(makeWalletClient(undefined))).toThrowError(
      /no bound account/,
    );
  });

  it("forwards the typed-data payload to walletClient.signTypedData with the resolved account", async () => {
    const wc = makeWalletClient({ address: ALICE_LOWER });
    const signer = signerFromWalletClient(wc);

    const sig = await signer.signTypedData(sampleTypedData);

    expect(sig).toBe("0xdeadbeef");
    expect(wc.signTypedData).toHaveBeenCalledTimes(1);
    expect(wc.signTypedData).toHaveBeenCalledWith({
      account: ALICE_CHECKSUM,
      ...sampleTypedData,
    });
  });

  it("forwards the override account, not the bound one, when signing", async () => {
    const wc = makeWalletClient({ address: ALICE_LOWER });
    const signer = signerFromWalletClient(wc, { account: BOB_LOWER });

    await signer.signTypedData(sampleTypedData);

    expect(wc.signTypedData).toHaveBeenCalledWith({
      account: BOB_CHECKSUM,
      ...sampleTypedData,
    });
  });
});

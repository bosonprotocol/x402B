// Shared test fixtures for the client-browser package.
//
// Centralises the address constants and the typed-data payload that
// `signer-from-eip1193.test.ts` and `signer-from-wallet-client.test.ts`
// both need. Mock/factory helpers stay local to each test file because
// they differ in interesting ways (one stubs an EIP-1193 `provider.request`,
// the other a viem-shaped `walletClient.signTypedData`).

export const ALICE_LOWER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
export const ALICE_CHECKSUM = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as const;
export const BOB_LOWER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
export const BOB_CHECKSUM = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as const;

export const sampleTypedData = {
  domain: { name: "Sample", version: "1", chainId: 8453, verifyingContract: ALICE_LOWER },
  types: { Hello: [{ name: "msg", type: "string" }] },
  primaryType: "Hello",
  message: { msg: "world" },
} as const;

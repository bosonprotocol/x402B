// Deterministic test accounts the `boson-protocol-node` container ships
// with. Verbatim copy of `bosonprotocol/core-components:contracts/accounts.js`
// at `main`. Every address listed here is pre-funded with native test ETH
// on the in-container chain. **Test keys only — never use on a real network.**
//
// Naming follows the source file (1-indexed; `ACCOUNT_1` is what Hardhat
// would label `ACCOUNT_0`). Names preserved so cross-referencing the
// upstream contracts repo / canonical compose env vars (`ACCOUNT_9`) stays
// straightforward.

import type { Address, Hex } from "viem";

export interface TestAccount {
  address: Address;
  privateKey: Hex;
}

export const ACCOUNT_1: TestAccount = {
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
};

export const ACCOUNT_2: TestAccount = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
};

export const ACCOUNT_3: TestAccount = {
  address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

export const ACCOUNT_4: TestAccount = {
  address: "0x3A78DE5B3b3BdF61339f6D683ee82c5743c7b3EE",
  privateKey: "0x3486daa503dcea7b6a3a9b956d5056f86bdae71323949588a90b2b65b75cd4e9",
};

export const ACCOUNT_5: TestAccount = {
  address: "0x130F244980978a5A46C7339DDf43176047d794Ce",
  privateKey: "0xa2e78cd4c87191e50d6a8f1610b1cf160b17216e9090dde7a92960a34c310482",
};

export const ACCOUNT_6: TestAccount = {
  address: "0xd0182FBe7E02B95dF76b11f596beB529f18013f9",
  privateKey: "0x2538569f1fa75a09fa2b5ec61995fdc6772b8b8bcbd26c6146e62f87dfc0b3ae",
};

export const ACCOUNT_7: TestAccount = {
  address: "0x573d92bFb23Ec56FD991E2f54267e518EFC5A9c1",
  privateKey: "0x213a02a5d190ccc5704ac9ec31a9f8ce7712e7ddba098ae1353c81d6e5046497",
};

export const ACCOUNT_8: TestAccount = {
  address: "0x1487756254E93d00a6DCDfc40bAe757c1e99E8c0",
  privateKey: "0x8e7f74d2eac64f4610b0ff0dea351b9f0fa61f31b0d3cc188b1dc8d5f71e7622",
};

/** Used by `meta-tx-gateway` in the canonical Boson e2e compose file. */
export const ACCOUNT_9: TestAccount = {
  address: "0x7aDCcBe646B707d0E8c0a339dF5277ee006f172B",
  privateKey: "0x316b234f5fea007dcc40404188b588fb90cb9bb1e33fc163e212eab2f8565293",
};

/**
 * Role assignments for the x402B e2e stack. Distinct accounts per role so
 * concurrent meta-tx submissions never share a relayer nonce.
 */
export const ROLE_ACCOUNTS = {
  /** Already wired into the meta-tx-gateway service in `compose.yaml`. */
  metaTxGatewayRelayer: ACCOUNT_9,
  /** `x402b-facilitator-http` service relayer wallet. */
  facilitatorRelayer: ACCOUNT_8,
  /** `x402b-resource-server` seller signer (FullOffer signatures). */
  seller: ACCOUNT_2,
  /** Buyer persona used by the harness (PR5+). */
  buyer: ACCOUNT_3,
  /** Dispute-resolver-operator persona used by the harness (PR5+). */
  resolver: ACCOUNT_4,
} as const;

// Translator that wraps a Boson `Web3LibAdapter` (e.g. an `EthersAdapter`
// from `@bosonprotocol/ethers-sdk`) as an x402-client `Signer`. The point
// is to let consumers who already hold an adapter for the deployed Boson
// protocol reuse it with `createX402bClient` without writing the shim
// themselves — and without forcing this package to take `ethers` (or
// `@bosonprotocol/common`) as a peer dep.
//
// Structural typing keeps the coupling minimal: `Web3LibAdapterLike` picks
// only the two methods we actually invoke. The consumer's own `ethers` /
// `@bosonprotocol/ethers-sdk` install carries the full types — an
// `EthersAdapter` instance satisfies `Web3LibAdapterLike` by shape.
//
// Note on `EIP712Domain` injection: `eth_signTypedData_v4` (and the
// `EthersAdapter` JSON path) expects `types.EIP712Domain` to be present
// and to match exactly the fields populated on `domain`. We derive it
// from `domain`'s field presence — the same rule viem applies internally
// in `getTypesForEIP712Domain`.

import {
  serializeTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
  type TypedDataDefinition,
  type TypedDataParameter,
} from "viem";

import type { Signer } from "./types.js";

/**
 * Structural subset of `@bosonprotocol/common`'s `Web3LibAdapter` that
 * {@link signerFromEthersAdapter} actually exercises. An `EthersAdapter`
 * from `@bosonprotocol/ethers-sdk` (or any future concrete adapter)
 * satisfies this shape without an explicit cast.
 */
export interface Web3LibAdapterLike {
  getSignerAddress(): Promise<string>;
  send(method: string, params: readonly unknown[]): Promise<unknown>;
}

/**
 * Wrap a Boson `Web3LibAdapter`-shaped object as an x402-client
 * {@link Signer}. `signTypedData` builds the standard
 * `eth_signTypedData_v4` JSON payload (including a derived
 * `EIP712Domain` type list) and routes it through `adapter.send`.
 */
export function signerFromEthersAdapter(adapter: Web3LibAdapterLike): Signer {
  return {
    getAddress: async () => (await adapter.getSignerAddress()) as Address,
    signTypedData: async ({ domain, types, primaryType, message }) => {
      const from = await adapter.getSignerAddress();
      const typedData = {
        domain,
        types: { ...types, EIP712Domain: deriveEip712DomainType(domain) },
        primaryType,
        message,
      };
      const json = serializeTypedData(typedData as unknown as TypedDataDefinition);
      const sig = await adapter.send("eth_signTypedData_v4", [from, json]);
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) {
        throw new Error(
          "signerFromEthersAdapter: adapter.send did not return a hex signature string",
        );
      }
      return sig as Hex;
    },
  };
}

/**
 * Build the `EIP712Domain` type-list from the fields actually present on
 * `domain`, in the canonical EIP-712 order (`name`, `version`, `chainId`,
 * `verifyingContract`, `salt`). Matches viem's internal derivation so the
 * resulting digest agrees with what a viem signer would produce.
 */
function deriveEip712DomainType(domain: TypedDataDomain): readonly TypedDataParameter[] {
  const fields: TypedDataParameter[] = [];
  if (domain.name !== undefined) fields.push({ name: "name", type: "string" });
  if (domain.version !== undefined) fields.push({ name: "version", type: "string" });
  if (domain.chainId !== undefined) fields.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract !== undefined)
    fields.push({ name: "verifyingContract", type: "address" });
  if (domain.salt !== undefined) fields.push({ name: "salt", type: "bytes32" });
  return fields;
}

// Build and sign the buyer's ERC-3009 `ReceiveWithAuthorization` for the
// escrow contract.
//
// The typed-data builder lives in `@bosonprotocol/x402-core` — reused here
// rather than redeclared so the type-list and primary-type stay in
// lock-step with the canonical EIP-3009 shape Boson expects. The buyer
// signs through the configured `Signer`; the resulting 65-byte hex
// signature is split into wire-format `{ v, r, s }` via viem's
// `parseSignature`.

import {
  erc3009TypedData,
  type TokenEip712Domain,
} from "@bosonprotocol/x402-core/eip712/token-auth";
import type {
  Erc3009AuthData,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { parseSignature, type Address } from "viem";

import { parseChainId } from "../core-sdk-factory.js";
import type { Signer, TokenDomainResolver } from "../types.js";
import { randomBytes32 } from "../utils/crypto.js";

export interface SignErc3009Args {
  requirements: EscrowPaymentRequirements;
  buyer: Address;
  signer: Signer;
  tokenDomainResolver: TokenDomainResolver;
  /** Override the wall-clock; injected by tests for determinism. Defaults to `Date.now()`. */
  now?: () => number;
}

/**
 * Build the ERC-3009 typed-data, sign it, and shape the result into the
 * `Erc3009AuthData` slot of the escrow payment payload.
 */
export async function signErc3009({
  requirements,
  buyer,
  signer,
  tokenDomainResolver,
  now = Date.now,
}: SignErc3009Args): Promise<Erc3009AuthData> {
  const chainId = parseChainId(requirements.network);
  const domain: TokenEip712Domain = await tokenDomainResolver(
    requirements.asset as Address,
    chainId,
  );

  const nonce = randomBytes32();
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(now() / 1000) + requirements.maxTimeoutSeconds);

  const typedData = erc3009TypedData({
    domain,
    message: {
      from: buyer,
      to: requirements.escrowAddress as Address,
      value: BigInt(requirements.amount),
      validAfter,
      validBefore,
      nonce,
    },
  });

  const signature = await signer.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: {
      from: typedData.message.from,
      to: typedData.message.to,
      value: typedData.message.value,
      validAfter: typedData.message.validAfter,
      validBefore: typedData.message.validBefore,
      nonce: typedData.message.nonce,
    },
  });
  const { v, r, s } = parseSignature(signature);

  return {
    from: buyer,
    to: requirements.escrowAddress,
    value: requirements.amount,
    validAfter: Number(validAfter),
    validBefore: Number(validBefore),
    nonce,
    v: Number(v),
    r,
    s,
  };
}

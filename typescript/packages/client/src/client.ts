// Top-level `createX402bClient` factory.
//
// Wires the action picker, token-auth strategy dispatcher, meta-tx signer
// (via `CoreSDK`), fulfillment resolver, and payload assembler into:
//
//   - `handle402(requirements)` — commit-time flow that emits the base64
//     `X-PAYMENT` value for the 402 retry.
//   - `signAction(args)` — post-commit flow that signs one of the buyer's
//     follow-up meta-transactions (redeem / cancel / complete / dispute
//     family). No token-auth or X-PAYMENT wrapping; the caller picks a
//     channel and POSTs the wire envelope.

import {
  parseEscrowPaymentRequirements,
  type EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import type { Address } from "viem";

import { pickAction } from "./action.js";
import { createCoreSdkFactory } from "./core-sdk-factory.js";
import { resolveFulfillment } from "./fulfillment.js";
import { assembleAndEncodePayload } from "./payload.js";
import {
  signCreateOfferAndCommitMetaTx,
  signCreateOfferCommitAndRedeemMetaTx,
} from "./pre-commit.js";
import {
  signPostCommitAction,
  type SignActionArgs,
  type SignedPostCommitAction,
} from "./post-commit.js";
import { parsePaymentResponse } from "./response.js";
import { buildAndSignTokenAuth } from "./token-auth/index.js";
import { MaxAmountExceededError } from "./errors.js";
import type { ExchangeSummary, X402bClientConfig } from "./types.js";

export interface X402bClient {
  /**
   * Consume a parsed escrow PaymentRequirements and return the base64
   * value to set as the `X-PAYMENT` header on the retry.
   */
  handle402(requirements: unknown): Promise<string>;

  /**
   * Sign a Boson protocol meta-transaction for a buyer-driven post-commit
   * action (redeem, cancel, complete, dispute family). Returns both the
   * wire-format `BosonMetaTx` envelope and the ABI-encoded `signedPayload`
   * Hex — pick the shape that matches the chosen channel. Server /
   * facilitator HTTP routes consume `signedPayload` directly (e.g. as
   * the `signedPayload` field on the JSON POST body to the endpoint the
   * prior response advertised under `actions.next[].endpoints.server`);
   * on-chain and MCP channels use the `metaTx` object.
   *
   * Note: `boson-escalateDispute` signs only the meta-tx. If the dispute
   * resolver requires an escalation deposit, the resolver/server returns
   * its own 402 with an `escrow` `PaymentRequirements` and the buyer pairs
   * this meta-tx with a token-auth payload — the deposit wrapper is out
   * of MVP.
   */
  signAction(args: SignActionArgs): Promise<SignedPostCommitAction>;

  /**
   * Best-effort decode of `X-PAYMENT-RESPONSE` after a successful retry.
   * Returns `undefined` when the header isn't present.
   */
  parsePaymentResponse(response: {
    headers: { get(name: string): string | null };
  }): ExchangeSummary | undefined;
}

/**
 * Build a stateless client bound to a buyer signer + policy. The
 * underlying `CoreSDK` is built lazily per `(chainId, escrowAddress)` and
 * cached across calls — both `handle402` and `signAction` reuse it.
 */
export function createX402bClient(config: X402bClientConfig): X402bClient {
  const buildCoreSdk = createCoreSdkFactory(config.signer, config);

  const getBuyerAddress = async () => (await config.signer.getAddress()) as Address;

  return {
    async handle402(rawRequirements) {
      const requirements: EscrowPaymentRequirements =
        parseEscrowPaymentRequirements(rawRequirements);

      const action = pickAction(requirements, config.policy);
      const fulfillment = resolveFulfillment(requirements, config);
      enforceMaxAmount(requirements.amount, config.policy?.maxAmount);
      const buyer = await getBuyerAddress();

      const { coreSdk, chainId } = buildCoreSdk(
        requirements.network,
        requirements.escrowAddress as Address,
      );

      const { tokenAuth, strategy } = await buildAndSignTokenAuth({
        requirements,
        buyer,
        coreSdk,
        tokenDomainResolver: config.tokenDomainResolver,
        publicClient: config.publicClients?.[chainId],
      });

      const signMetaTx =
        action === "boson-createOfferCommitAndRedeem"
          ? signCreateOfferCommitAndRedeemMetaTx
          : signCreateOfferAndCommitMetaTx;
      const metaTx = await signMetaTx({ requirements, coreSdk, buyer });

      return assembleAndEncodePayload({
        requirements,
        action,
        tokenAuthStrategy: strategy,
        metaTx,
        tokenAuth,
        fulfillment,
        buyer,
      });
    },

    signAction(args) {
      return signPostCommitAction(args, { buildCoreSdk, getBuyerAddress });
    },

    parsePaymentResponse(response) {
      return parsePaymentResponse(response);
    },
  };
}

function enforceMaxAmount(amount: string, maxAmount?: string): void {
  if (maxAmount === undefined) {
    return;
  }

  const amountBigInt = BigInt(amount);
  const maxAmountBigInt = BigInt(maxAmount);
  if (amountBigInt > maxAmountBigInt) {
    throw new MaxAmountExceededError(
      `x402-client: requirements.amount ${amount} exceeds policy.maxAmount ${maxAmount}`,
    );
  }
}

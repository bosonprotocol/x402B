// Shared test fixtures for the facilitator package.
//
// Centralises the scalar constants, signer accounts, and the `fullOffer`
// shape used by both `verify.test.ts` and `settle.test.ts` (and any
// future test file that drives the full verify/settle pipeline). When
// the Boson calldata shape changes, this is the only place to update.
//
// Each consumer keeps its own client / mock builders local — they
// differ in interesting ways (verify needs `publicClient.call`,
// settle additionally needs `waitForTransactionReceipt` +
// `walletClient.sendTransaction`, etc.) and the differences are part
// of each test's intent.

import { metaTransactionTypedData } from "@bosonprotocol/x402-core/eip712";
import type {
  EscrowPaymentPayload,
  EscrowPaymentRequirements,
} from "@bosonprotocol/x402-core/schemes/escrow";
import { buildCreateOfferAndCommitCalldata } from "@bosonprotocol/x402-evm/actions";
import { parseSignature, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Fixed test vectors — deterministic across runs. Re-used between
// verify and settle test suites so the typed-data the buyer signs in
// one is bit-for-bit identical to what the other expects.
export const BUYER_PK =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
export const buyer = privateKeyToAccount(BUYER_PK);
export const RELAYER_PK =
  "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" as const;
export const relayer = privateKeyToAccount(RELAYER_PK);

export const ESCROW: Address = "0xdddddddddddddddddddddddddddddddddddddddd";
export const ASSET: Address = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const CHAIN_ID = 1;
export const NETWORK = `eip155:${CHAIN_ID}`;
export const NONCE = "1";
export const SELLER: Address = "0x1111111111111111111111111111111111111111";
export const SELLER_SIG: Hex = `0x${"33".repeat(65)}`;
export const AMOUNT = "1000000";

/**
 * Canonical `fullOffer` literal used to build a real meta-tx calldata
 * via `buildCreateOfferAndCommitCalldata`. Both verify and settle
 * require the on-chain calldata embedded in `payload.metaTx` to match
 * what `requirements.offer.fullOffer` advertises — duplicating this
 * literal across test files would silently drift the moment the Boson
 * `FullOffer` struct changes.
 */
export const fullOffer = {
  price: AMOUNT,
  sellerDeposit: "0",
  agentId: "0",
  buyerCancelPenalty: "0",
  quantityAvailable: "1",
  validFromDateInMS: "1900000000000",
  validUntilDateInMS: "1900003600000",
  voucherRedeemableFromDateInMS: "1900000000000",
  voucherRedeemableUntilDateInMS: "1900003600000",
  disputePeriodDurationInMS: "86400000",
  voucherValidDurationInMS: "0",
  resolutionPeriodDurationInMS: "604800000",
  exchangeToken: ASSET,
  disputeResolverId: "1",
  metadataUri: "ipfs://QmDeadBeef",
  metadataHash: "QmDeadBeef",
  collectionIndex: "0",
  feeLimit: "0",
  offerCreator: SELLER,
  committer: buyer.address,
  condition: {
    method: 0,
    tokenType: 0,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    gatingType: 0,
    minTokenId: "0",
    threshold: "0",
    maxCommits: "0",
    maxTokenId: "0",
  },
  useDepositedFunds: false,
  signature: SELLER_SIG,
  sellerId: "12345",
  buyerId: "0",
  sellerOfferParams: {
    collectionIndex: "0",
    royaltyInfo: { recipients: [], bps: [] },
    mutualizerAddress: "0x0000000000000000000000000000000000000000",
  },
};

/**
 * Build a fully-signed `EscrowPaymentPayload` for
 * `tokenAuthStrategy: "none"`, using the shared `fullOffer` so the
 * resulting calldata is consistent with what `buildValidRequirements`
 * advertises.
 */
export async function buildValidPayload(): Promise<EscrowPaymentPayload> {
  const calldata = buildCreateOfferAndCommitCalldata({
    fullOffer: fullOffer as Parameters<typeof buildCreateOfferAndCommitCalldata>[0]["fullOffer"],
  });
  const typedData = await metaTransactionTypedData({
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
    message: {
      nonce: BigInt(NONCE),
      from: buyer.address,
      contractAddress: ESCROW,
      functionName: calldata.functionName,
      functionSignature: calldata.functionSignature,
    },
  });
  const sig = await buyer.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const parsed = parseSignature(sig);
  // viem returns v=27/28 only when yParity is set; normalise to 27/28
  // explicitly so the buyer's BosonMetaTx field matches the on-chain
  // LibSignature.recover expectation.
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity === 0 ? 27 : 28;
  return {
    x402Version: 1,
    scheme: "escrow",
    network: NETWORK,
    payload: {
      action: "boson-createOfferAndCommit",
      tokenAuthStrategy: "none",
      offerRef: { fullOffer, sellerSig: SELLER_SIG },
      buyer: buyer.address,
      metaTx: {
        from: buyer.address,
        nonce: NONCE,
        functionName: calldata.functionName,
        functionSignature: calldata.functionSignature,
        sig: { v, r: parsed.r, s: parsed.s },
      },
    },
  };
}

/** Build matching `EscrowPaymentRequirements`. */
export function buildValidRequirements(): EscrowPaymentRequirements {
  return {
    scheme: "escrow",
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    escrowAddress: ESCROW,
    recipientId: "did:boson:seller:42",
    maxTimeoutSeconds: 3600,
    offer: {
      fullOffer,
      sellerSig: SELLER_SIG,
      creator: SELLER,
    },
    tokenAuthStrategies: ["none"],
    actions: {
      next: [
        {
          id: "boson-createOfferAndCommit",
          channels: ["server", "facilitator", "onchain"],
        },
      ],
    },
  };
}

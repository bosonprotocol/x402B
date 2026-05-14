// Placeholder values for the meta-tx fields the SDK's `signMetaTx*` helpers
// require but the calldata-builder modules don't care about.
//
// Both `actions/create-offer-and-commit.ts` and
// `actions/create-offer-commit-and-redeem.ts` delegate the
// `{ functionName, functionSignature }` pair to
// `metaTx.handler.signMetaTx*({ returnTypedDataToSign: true })`. The
// SDK requires `chainId`, `metaTxHandlerAddress`, and `nonce` to build
// the meta-tx typed-data domain, but those affect only the typed-data
// portion of the response — the `functionName` selector literal and the
// ABI-encoded `functionSignature` we read back are independent of all
// three. We pass these constants and discard the typed-data.

/** Meta-tx EIP-712 domain `chainId` — not 0 to dodge any future "is this network configured" check. */
export const DUMMY_CHAIN_ID = 1;

/** Meta-tx handler `verifyingContract` — zero is fine; the SDK never deref's it on the typed-data-only path. */
export const DUMMY_METATX_HANDLER_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Meta-tx replay-protection nonce — decimal string, kept as `"0"` for determinism. */
export const DUMMY_NONCE = "0";

// Placeholder values for the meta-tx fields the SDK's `signMetaTx*` helpers
// require but the calldata-builder modules don't care about.
//
// The builders delegate the `{ functionName, functionSignature }` pair to
// `metaTx.handler.signMetaTx*({ returnTypedDataToSign: true })`. The SDK
// requires `chainId`, `metaTxHandlerAddress`, and `nonce` to build the
// meta-tx typed-data domain, but those affect only the typed-data portion
// of the response; the selector literal and ABI-encoded calldata we read
// back are independent of all three.

export const DUMMY_CHAIN_ID = 1;
export const DUMMY_METATX_HANDLER_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DUMMY_NONCE = "0";

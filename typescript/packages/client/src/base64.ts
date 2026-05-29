// Isomorphic base64 helpers used by the X-PAYMENT / X-PAYMENT-RESPONSE
// header pipeline. Picks `Buffer` on Node and `atob` / `btoa` on
// browsers — tsup builds both formats, so the runtime branch matters.
//
// Browser-side encode goes UTF-8 → binary-string → `btoa` because
// `btoa` accepts only code units 0–255 and throws
// `InvalidCharacterError` on any character above U+00FF, while wire
// payloads can carry free-form fulfillment data populated by the
// buyer (emails, addresses, notes). Decode does the inverse.

/** Decode a base64-encoded string to UTF-8. */
export function decodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Encode a UTF-8 string as base64. */
export function encodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

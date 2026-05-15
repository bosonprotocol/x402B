// Typed error classes for the x402-client. Each is a leaf `Error` subclass
// with a stable `name` so callers can branch on `instanceof` or string-match
// without parsing messages.

export class UnsupportedSchemeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSchemeError";
  }
}

export class UnsupportedTokenAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTokenAuthError";
  }
}

export class NoCompatibleActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCompatibleActionError";
  }
}

export class FulfillmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FulfillmentValidationError";
  }
}

export class MaxAmountExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaxAmountExceededError";
  }
}

---
"@bosonprotocol/x402-client": patch
---

Make the token-auth strategy picker capability-aware.

When the server advertises multiple strategies (e.g. `["erc3009", "permit2"]`)
and the client lacks the runtime prerequisites for the preferred one
(e.g. no `tokenDomainResolver` in `X402bClientConfig`), the picker now
falls back to the next advertised strategy it can actually sign instead
of throwing. Permit2 in particular requires no extra configuration, so a
client configured without `tokenDomainResolver` will silently use Permit2
whenever the server lists it as an alternative.

`UnsupportedTokenAuthError` is now thrown only when the intersection
(advertised) ∩ (preferred) ∩ (client-capable) is empty. The error message
lists what's advertised and which client-side prerequisite is missing so
deployments without `tokenDomainResolver` can diagnose the gap.

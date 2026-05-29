---
"@bosonprotocol/x402-server": minor
"@bosonprotocol/x402-facilitator-express": minor
---

Production-readiness rollup for the server SDK (PR #68): persistent Store with
recovery, request mutex/concurrency guard, facilitator-client hardening,
structured logger, production-mode config validation, recovery replay API, and
health-check endpoint. `facilitator-express` mounts a `GET /healthz` liveness
probe.

This changeset is added retroactively: PR #68 merged without one, so its changes
were never version-bumped or published.

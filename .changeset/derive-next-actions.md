---
"@bosonprotocol/x402-actions": minor
"@bosonprotocol/x402-core": minor
---

Add `deriveNextActions` and `deriveInitialNextActions` to
`@bosonprotocol/x402-actions` — pure envelope builders that read the
client-invokable transitions from `x402-core`'s state-machine tables
and stamp them with the seller's configured channels, endpoints, and
optional deadlines.

In `@bosonprotocol/x402-core`:

- Add the post-commit `EscrowNextActions` type, its zod validator
  (`escrowNextActionsSchema` / `parseEscrowNextActions`), and the JSON
  Schema `next_actions.schema.json` (re-exported under
  `./schemas/next_actions.schema.json`). The type and schema encode the
  spec invariant that `state === DISPUTED` ↔ `disputeState` is present.
- Extend the `NextAction` wire-format type and the
  `payment_requirements.schema.json` `actions.next[]` items with an
  optional ISO 8601 `deadline` field (relevant for
  dispute-window-bounded actions).
